import { describe, expect, it } from "vitest";
import {
  createAiLimits,
  createReviewLimits,
  DEFAULT_SERVER_PARAGRAPHS_PER_DAY,
  serverDailyCap,
} from "@/lib/ai/limits";
import { createAuthLimits, UNKNOWN_IP } from "@/lib/auth/limits";
import { domainsText, emailAllowed, signupPolicy } from "@/lib/auth/signup-policy";
import { createGate } from "@/lib/concurrency";

describe("createGate", () => {
  it("lets at most max holders in, and refuses the rest at once", () => {
    const gate = createGate(2);
    const a = gate.tryEnter();
    const b = gate.tryEnter();
    expect(a && b).toBeTruthy();
    expect(gate.tryEnter()).toBeNull();
    a!();
    a!(); // Leaving twice frees one place, not two.
    expect(gate.active).toBe(1);
    expect(gate.tryEnter()).not.toBeNull();
    expect(gate.tryEnter()).toBeNull();
  });
});

describe("sign-in per IP across emails", () => {
  it("limits one trusted address trying many accounts", () => {
    const limits = createAuthLimits(() => 0);
    for (let i = 0; i < 30; i++) {
      expect(limits.allowSignIn(`person${i}@example.com`, "203.0.113.9")).toBe(true);
    }
    expect(limits.allowSignIn("someone-new@example.com", "203.0.113.9")).toBe(false);
    // Another address is unaffected.
    expect(limits.allowSignIn("someone-new@example.com", "198.51.100.1")).toBe(true);
  });

  it("does not apply when addresses cannot be trusted (everyone shares UNKNOWN_IP)", () => {
    const limits = createAuthLimits(() => 0);
    for (let i = 0; i < 60; i++) {
      expect(limits.allowSignIn(`person${i}@example.com`, UNKNOWN_IP)).toBe(true);
    }
  });
});

describe("server-wide AI caps", () => {
  it("reads a positive integer from the environment, or falls back", () => {
    expect(serverDailyCap("5000", 1)).toBe(5000);
    expect(serverDailyCap(" 12 ", 1)).toBe(12);
    for (const bad of [undefined, "", "0", "-3", "1.5", "lots"]) {
      expect(serverDailyCap(bad, 7)).toBe(7);
    }
    expect(DEFAULT_SERVER_PARAGRAPHS_PER_DAY).toBeGreaterThan(600);
  });

  it("stops every user together once the server's day is used up", () => {
    const limits = createAiLimits(() => 0, 3);
    expect(limits.check("ana").ok).toBe(true);
    expect(limits.check("ben").ok).toBe(true);
    expect(limits.check("cai").ok).toBe(true);
    const refused = limits.check("dee");
    expect(refused).toMatchObject({ ok: false, scope: "server" });
  });

  it("does not let one user's refused requests use up the server's allowance", () => {
    const limits = createAiLimits(() => 0, 40);
    for (let i = 0; i < 100; i++) limits.check("greedy"); // 30 allowed a minute, 70 refused
    for (let i = 0; i < 10; i++) expect(limits.check(`other${i}`).ok).toBe(true);
    expect(limits.check("someone").ok).toBe(false);
  });

  it("caps reviews server-wide too", () => {
    const limits = createReviewLimits(() => 0, 2);
    expect(limits.check("ana").ok).toBe(true);
    expect(limits.check("ben").ok).toBe(true);
    expect(limits.check("cai")).toMatchObject({ ok: false, scope: "server" });
  });
});

describe("sign-up policy", () => {
  it("is open by default and closed only when it says so", () => {
    expect(signupPolicy({}).open).toBe(true);
    expect(signupPolicy({ POLARIS_SIGNUP: "closed" }).open).toBe(false);
    expect(signupPolicy({ POLARIS_SIGNUP: " CLOSED " }).open).toBe(false);
    expect(signupPolicy({ POLARIS_SIGNUP: "open" }).open).toBe(true);
  });

  it("allows the listed domains and their subdomains only", () => {
    const policy = signupPolicy({ POLARIS_SIGNUP_EMAIL_DOMAINS: "uni.edu, @college.ac.uk" });
    expect(policy.domains).toEqual(["uni.edu", "college.ac.uk"]);
    expect(emailAllowed("ana@uni.edu", policy)).toBe(true);
    expect(emailAllowed("ana@cs.uni.edu", policy)).toBe(true);
    expect(emailAllowed("ben@college.ac.uk", policy)).toBe(true);
    expect(emailAllowed("eve@evil-uni.edu", policy)).toBe(false);
    expect(emailAllowed("eve@uni.edu.evil.com", policy)).toBe(false);
    expect(emailAllowed("eve@gmail.com", policy)).toBe(false);
    expect(emailAllowed("anyone@anywhere.org", signupPolicy({}))).toBe(true);
  });

  it("names the domains in a sentence", () => {
    expect(domainsText(["uni.edu"])).toBe("uni.edu");
    expect(domainsText(["a.edu", "b.edu", "c.edu"])).toBe("a.edu, b.edu or c.edu");
  });
});
