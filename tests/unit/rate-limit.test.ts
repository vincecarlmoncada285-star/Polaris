import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set: (next: number) => {
      t = next;
    },
  };
}

describe("rate limiter", () => {
  it("allows `limit` attempts in the window and rejects the next", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
    expect(limiter.hit("k")).toEqual({ ok: true, remaining: 2, retryAfterMs: 0 });
    expect(limiter.hit("k")).toEqual({ ok: true, remaining: 1, retryAfterMs: 0 });
    expect(limiter.hit("k")).toEqual({ ok: true, remaining: 0, retryAfterMs: 0 });
    c.set(400);
    expect(limiter.hit("k")).toEqual({ ok: false, remaining: 0, retryAfterMs: 600 });
  });

  it("slides: each attempt expires windowMs after it was made", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now });
    limiter.hit("k"); // t=0
    c.set(500);
    limiter.hit("k"); // t=500
    c.set(999);
    expect(limiter.hit("k").ok).toBe(false);
    // The t=0 attempt leaves the window at exactly t=1000; the t=500 one is still in it.
    c.set(1000);
    expect(limiter.hit("k")).toMatchObject({ ok: true, remaining: 0 });
    c.set(1001);
    expect(limiter.hit("k")).toMatchObject({ ok: false, retryAfterMs: 499 });
    // Long after everything: a full allowance again.
    c.set(10_000);
    expect(limiter.hit("k")).toMatchObject({ ok: true, remaining: 1 });
  });

  it("does not count rejected attempts, so hammering does not extend the lockout", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
    limiter.hit("k");
    for (let t = 1; t < 1000; t += 100) {
      c.set(t);
      expect(limiter.hit("k").ok).toBe(false);
    }
    c.set(1000);
    expect(limiter.hit("k").ok).toBe(true);
  });

  it("keeps keys independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.hit("a@example.com|1.2.3.4").ok).toBe(true);
    expect(limiter.hit("a@example.com|1.2.3.4").ok).toBe(false);
    expect(limiter.hit("a@example.com|5.6.7.8").ok).toBe(true);
    expect(limiter.hit("b@example.com|1.2.3.4").ok).toBe(true);
  });

  it("resets one key or all of them", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    limiter.hit("a");
    limiter.hit("b");
    limiter.reset("a");
    expect(limiter.hit("a").ok).toBe(true);
    expect(limiter.hit("b").ok).toBe(false);
    limiter.reset();
    expect(limiter.size).toBe(0);
    expect(limiter.hit("b").ok).toBe(true);
  });

  it("drops expired keys before evicting live ones when over maxKeys", () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 100, now: c.now, maxKeys: 2 });
    limiter.hit("old-1");
    limiter.hit("old-2");
    c.set(500);
    limiter.hit("new");
    expect(limiter.size).toBe(1);
  });

  it("evicts the least recently used live key when over maxKeys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0, maxKeys: 2 });
    limiter.hit("a");
    limiter.hit("b");
    limiter.hit("a"); // rejected, but touches "a"
    limiter.hit("c"); // over the cap: "b" goes
    expect(limiter.size).toBe(2);
    expect(limiter.hit("a").ok).toBe(false);
    expect(limiter.hit("b").ok).toBe(true);
  });

  it("rejects nonsense options", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
