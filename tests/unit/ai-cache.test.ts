import { describe, expect, it } from "vitest";
import { createFeedbackCache, feedbackCacheKey, type FeedbackKeyInput } from "@/lib/ai/cache";
import { createAiLimits } from "@/lib/ai/limits";

const HOUR = 60 * 60_000;
const entry = (n: number) => ({ suggestions: [], ...(n ? {} : { refused: true as const }) });

describe("feedback cache", () => {
  it("returns what was stored until the TTL runs out", () => {
    let t = 0;
    const cache = createFeedbackCache({ ttlMs: 24 * HOUR, now: () => t });
    cache.set("k", entry(1));
    t = 24 * HOUR - 1;
    expect(cache.get("k")).toEqual(entry(1));
    t = 24 * HOUR;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("defaults to a 24 hour TTL", () => {
    let t = 0;
    const cache = createFeedbackCache({ now: () => t });
    cache.set("k", entry(1));
    t = 24 * HOUR - 1;
    expect(cache.get("k")).toBeDefined();
    t = 24 * HOUR;
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts the least recently used entry beyond capacity", () => {
    const cache = createFeedbackCache({ capacity: 2 });
    cache.set("a", entry(1));
    cache.set("b", entry(1));
    cache.get("a"); // a is now the most recent
    cache.set("c", entry(1));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("keeps a cached refusal's flag", () => {
    const cache = createFeedbackCache();
    cache.set("k", entry(0));
    expect(cache.get("k")).toEqual({ suggestions: [], refused: true });
  });

  it("clears", () => {
    const cache = createFeedbackCache();
    cache.set("k", entry(1));
    cache.clear();
    expect(cache.get("k")).toBeUndefined();
  });
});

describe("feedbackCacheKey", () => {
  const base: FeedbackKeyInput = {
    model: "claude-opus-5-5",
    effort: "low",
    promptVersion: "v1",
    goals: { citationStyle: "apa", audience: "expert" },
    text: "A paragraph about sleep and memory.",
  };

  it("is a sha256 hex digest that does not contain the text", () => {
    const key = feedbackCacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("sleep");
  });

  it("does not depend on the order of the goals' keys", () => {
    expect(feedbackCacheKey({ ...base, goals: { audience: "expert", citationStyle: "apa" } })).toBe(
      feedbackCacheKey(base),
    );
  });

  it("treats a missing goal and an undefined one the same", () => {
    expect(feedbackCacheKey({ ...base, goals: { ...base.goals, formality: undefined } })).toBe(
      feedbackCacheKey(base),
    );
  });

  it.each<[string, Partial<FeedbackKeyInput>]>([
    ["model", { model: "claude-haiku-5-5" }],
    ["effort", { effort: "medium" }],
    ["prompt version", { promptVersion: "v2" }],
    ["goals", { goals: { citationStyle: "mla", audience: "expert" } }],
    ["text", { text: "A paragraph about sleep and memory!" }],
    ["title", { title: "Sleep" }],
    ["previous paragraph", { previous: "Earlier." }],
  ])("changes with the %s", (_label, change) => {
    expect(feedbackCacheKey({ ...base, ...change })).not.toBe(feedbackCacheKey(base));
  });

  it("cannot be confused by moving text between fields", () => {
    expect(feedbackCacheKey({ ...base, text: "ab", title: "c" })).not.toBe(
      feedbackCacheKey({ ...base, text: "a", title: "bc" }),
    );
  });
});

describe("AI rate limits", () => {
  it("allows 30 requests a minute per user", () => {
    let t = 0;
    const limits = createAiLimits(() => t);
    for (let i = 0; i < 30; i++) expect(limits.check("u1").ok).toBe(true);
    const refused = limits.check("u1");
    expect(refused).toEqual({ ok: false, retryAfterMs: 60_000, scope: "user" });
    expect(limits.check("u2").ok).toBe(true);
    t = 60_000;
    expect(limits.check("u1").ok).toBe(true);
  });

  it("allows 600 a day, and refused bursts do not use up the day", () => {
    let t = 0;
    const limits = createAiLimits(() => t);
    for (let minute = 0; minute < 20; minute++) {
      t = minute * 60_000;
      for (let i = 0; i < 30; i++) expect(limits.check("u1").ok).toBe(true);
      // Refused by the minute limit: must not count against the day.
      expect(limits.check("u1").ok).toBe(false);
    }
    t = 20 * 60_000;
    const refused = limits.check("u1");
    expect(refused.ok).toBe(false);
    // The first of the day's requests (t = 0) leaves the window after 24 hours.
    expect(refused).toEqual({ ok: false, retryAfterMs: 24 * HOUR - 20 * 60_000, scope: "user" });
    t = 24 * HOUR;
    expect(limits.check("u1").ok).toBe(true);
  });
});
