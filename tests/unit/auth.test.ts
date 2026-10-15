import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "@/lib/auth/callback-url";
import {
  clientIp,
  createAuthLimits,
  signInKey,
  trustedProxyHops,
  UNKNOWN_IP,
} from "@/lib/auth/limits";
import { isProtectedPath, routeDecision } from "@/lib/auth/routes";

describe("sanitizeCallbackUrl", () => {
  it.each([
    ["/", "/"],
    ["/documents/abc", "/documents/abc"],
    ["/documents/abc?tab=goals", "/documents/abc?tab=goals"],
    ["/documents/abc#p3", "/documents/abc#p3"],
    ["/settings", "/settings"],
    // Normalized, but still on our origin.
    ["/documents/../settings", "/settings"],
    ["/./documents/abc", "/documents/abc"],
    ["/documents/%2e%2e/settings", "/settings"],
  ])("accepts the same-origin path %j", (input, expected) => {
    expect(sanitizeCallbackUrl(input)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "//evil.com/documents/abc",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/documents/abc",
    "HTTPS://evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    // Dot segments that only become `//evil.com` once the path is normalized.
    "/.//evil.com",
    "/..//evil.com",
    "/%2e//evil.com",
    "/%2e%2e//evil.com",
    "/%2E%2E//evil.com",
    "/a/..//evil.com/x",
    "/documents/../..//evil.com",
    "\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n/evil.com",
    "javascript:alert(1)",
    "JavaScript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "documents/abc",
    " /documents/abc",
    "evil.com",
    "",
    `/${"a".repeat(2048)}`,
  ])("rejects %j", (input) => {
    expect(sanitizeCallbackUrl(input)).toBe("/");
  });

  it.each([undefined, null, 42, ["/documents/abc"], { href: "/" }])(
    "rejects the non-string %j",
    (input) => {
      expect(sanitizeCallbackUrl(input)).toBe("/");
    },
  );

  it("uses the given fallback", () => {
    expect(sanitizeCallbackUrl("//evil.com", "/settings")).toBe("/settings");
  });
});

describe("routeDecision (middleware)", () => {
  it("protects the library, documents and settings", () => {
    for (const path of ["/", "/documents", "/documents/abc", "/settings", "/settings/extra"]) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });

  it("does not protect look-alike or public paths", () => {
    for (const path of ["/documentsx", "/settings-old", "/signin", "/signup", "/session/expired"]) {
      expect(isProtectedPath(path)).toBe(false);
      expect(routeDecision(path, "", false)).toEqual({ kind: "allow" });
    }
  });

  it("sends signed-out visitors to sign in with the path they wanted", () => {
    expect(routeDecision("/", "", false)).toEqual({
      kind: "redirect",
      to: "/signin?callbackUrl=%2F",
    });
    const decision = routeDecision("/documents/abc", "?tab=goals", false);
    expect(decision).toEqual({
      kind: "redirect",
      to: "/signin?callbackUrl=%2Fdocuments%2Fabc%3Ftab%3Dgoals",
    });
    // The sign-in page must accept what middleware sends it.
    const callbackUrl = new URL(
      (decision as { to: string }).to,
      "http://localhost",
    ).searchParams.get("callbackUrl");
    expect(sanitizeCallbackUrl(callbackUrl)).toBe("/documents/abc?tab=goals");
  });

  it("lets signed-in users through to protected pages", () => {
    for (const path of ["/", "/documents/abc", "/settings"]) {
      expect(routeDecision(path, "", true)).toEqual({ kind: "allow" });
    }
  });

  it("sends signed-in users away from sign-in and sign-up, and lets signed-out ones in", () => {
    for (const path of ["/signin", "/signup"]) {
      expect(routeDecision(path, "?callbackUrl=%2F", true)).toEqual({ kind: "redirect", to: "/" });
      expect(routeDecision(path, "", false)).toEqual({ kind: "allow" });
    }
  });
});

describe("clientIp", () => {
  it("ignores client-supplied headers unless a proxy is trusted", () => {
    // Without a proxy, `next start` passes a client's own X-Forwarded-For straight through.
    for (const headers of [
      { "x-forwarded-for": "10.0.0.1" } as Record<string, string>,
      { "x-forwarded-for": "6.6.6.6, 203.0.113.7" },
      { "x-real-ip": "198.51.100.2" },
      {},
    ]) {
      expect(clientIp(new Headers(headers), 0)).toBe(UNKNOWN_IP);
    }
  });

  it("behind one proxy, uses the address that proxy appended", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.7" }), 1)).toBe(
      "203.0.113.7",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 " }), 1)).toBe("203.0.113.7");
    // Empty entries are not hops.
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, , 203.0.113.7" }), 1)).toBe(
      "203.0.113.7",
    );
  });

  it("behind two proxies, skips the inner proxy's own entry", () => {
    expect(
      clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 192.0.2.10" }), 2),
    ).toBe("203.0.113.7");
    // A shorter chain than configured: the leftmost entry is the furthest any proxy saw.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }), 2)).toBe("203.0.113.7");
  });

  it("behind a proxy, falls back to X-Real-IP, then to the shared bucket", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }), 1)).toBe("198.51.100.2");
    expect(clientIp(new Headers({ "x-forwarded-for": " , " }), 1)).toBe(UNKNOWN_IP);
    expect(clientIp(new Headers(), 1)).toBe(UNKNOWN_IP);
  });

  it("reads TRUSTED_PROXY_HOPS as a non-negative integer, defaulting to 0", () => {
    expect(trustedProxyHops(undefined)).toBe(0);
    expect(trustedProxyHops("")).toBe(0);
    expect(trustedProxyHops(" 1 ")).toBe(1);
    expect(trustedProxyHops("2")).toBe(2);
    for (const bad of ["true", "-1", "1.5", "one", "NaN"]) expect(trustedProxyHops(bad)).toBe(0);
  });
});

describe("sign-in limits", () => {
  it("allows 10 attempts per email and IP in 15 minutes", () => {
    let t = 0;
    const limits = createAuthLimits(() => t);
    for (let i = 0; i < 10; i++) {
      expect(limits.allowSignIn("ada@example.com", "1.2.3.4")).toBe(true);
    }
    expect(limits.allowSignIn(" ADA@example.com", "1.2.3.4")).toBe(false);
    // Another address, or another account, has its own allowance.
    expect(limits.allowSignIn("ada@example.com", "5.6.7.8")).toBe(true);
    expect(limits.allowSignIn("grace@example.com", "1.2.3.4")).toBe(true);
    t = 15 * 60_000;
    expect(limits.allowSignIn("ada@example.com", "1.2.3.4")).toBe(true);
  });

  it("caps one account at 50 attempts an hour, however many addresses they come from", () => {
    let t = 0;
    const limits = createAuthLimits(() => t);
    for (let i = 0; i < 50; i++) {
      expect(limits.allowSignIn("ada@example.com", `10.0.0.${i}`)).toBe(true);
    }
    expect(limits.allowSignIn("ada@example.com", "10.0.1.1")).toBe(false);
    expect(limits.allowSignIn("Ada@Example.com ", "10.0.1.2")).toBe(false);
    // Other accounts are unaffected, and the cap lifts after the hour.
    expect(limits.allowSignIn("grace@example.com", "10.0.1.1")).toBe(true);
    t = 60 * 60_000;
    expect(limits.allowSignIn("ada@example.com", "10.0.1.3")).toBe(true);
  });

  it("does not spend the account's shared allowance on attempts its IP limit refuses", () => {
    const limits = createAuthLimits(() => 0);
    for (let i = 0; i < 100; i++) limits.allowSignIn("ada@example.com", "1.2.3.4");
    // 10 got through on 1.2.3.4; the other 90 were refused before reaching the per-email cap.
    for (let i = 0; i < 40; i++) {
      expect(limits.allowSignIn("ada@example.com", `10.0.0.${i}`)).toBe(true);
    }
    expect(limits.allowSignIn("ada@example.com", "10.0.1.1")).toBe(false);
  });
});

describe("sign-up and password-change limits", () => {
  it("allows 5 sign-ups per IP an hour, independently per IP", () => {
    let t = 0;
    const limits = createAuthLimits(() => t);
    for (let i = 0; i < 5; i++) expect(limits.signUp.hit("1.2.3.4").ok).toBe(true);
    expect(limits.signUp.hit("1.2.3.4").ok).toBe(false);
    expect(limits.signUp.hit("5.6.7.8").ok).toBe(true);
    t = 60 * 60_000 - 1;
    expect(limits.signUp.hit("1.2.3.4").ok).toBe(false);
    t = 60 * 60_000;
    expect(limits.signUp.hit("1.2.3.4").ok).toBe(true);
  });

  it("allows 10 password-change attempts per account in 15 minutes", () => {
    let t = 0;
    const limits = createAuthLimits(() => t);
    for (let i = 0; i < 10; i++) expect(limits.changePassword.hit("user-a").ok).toBe(true);
    expect(limits.changePassword.hit("user-a").ok).toBe(false);
    expect(limits.changePassword.hit("user-b").ok).toBe(true);
    t = 15 * 60_000;
    expect(limits.changePassword.hit("user-a").ok).toBe(true);
  });
});

describe("rate-limit keys", () => {
  it("keys sign-in by normalized email and IP", () => {
    expect(signInKey("  Ada@Example.com ", "1.2.3.4")).toBe(
      signInKey("ada@example.com", "1.2.3.4"),
    );
    expect(signInKey("ada@example.com", "1.2.3.4")).not.toBe(
      signInKey("ada@example.com", "5.6.7.8"),
    );
  });
});
