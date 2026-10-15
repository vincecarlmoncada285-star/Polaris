export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in the current window after this one. */
  remaining: number;
  /** When `ok` is false: how long until the oldest attempt leaves the window. */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Record an attempt for `key`. Rejected attempts are not recorded. */
  hit(key: string): RateLimitResult;
  /** Forget one key, or every key. */
  reset(key?: string): void;
  /** Number of keys currently tracked (for tests and monitoring). */
  readonly size: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Injectable clock, so tests do not need fake timers. */
  now?: () => number;
  /** Upper bound on tracked keys, so a flood of unique keys cannot exhaust memory. */
  maxKeys?: number;
}

/**
 * In-memory sliding-window log: a key may make `limit` attempts in any `windowMs` span.
 * Per process only, which is enough for a single self-hosted instance; a multi-instance
 * deployment needs a shared store (Redis, the database) behind the same interface.
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: RateLimiterOptions): RateLimiter {
  if (limit < 1 || windowMs <= 0) throw new Error("Rate limiter needs limit >= 1 and windowMs > 0");
  // Map iteration order is insertion order; touched keys are re-inserted, so the first
  // entries are the least recently used.
  const hits = new Map<string, number[]>();

  const live = (stamps: number[], t: number) => stamps.filter((s) => s > t - windowMs);

  function sweep(t: number) {
    for (const [key, stamps] of hits) {
      const kept = live(stamps, t);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
    for (const key of hits.keys()) {
      if (hits.size <= maxKeys) break;
      hits.delete(key);
    }
  }

  return {
    hit(key) {
      const t = now();
      const stamps = live(hits.get(key) ?? [], t);
      hits.delete(key);
      if (stamps.length >= limit) {
        hits.set(key, stamps);
        return { ok: false, remaining: 0, retryAfterMs: stamps[0] + windowMs - t };
      }
      stamps.push(t);
      hits.set(key, stamps);
      if (hits.size > maxKeys) sweep(t);
      return { ok: true, remaining: limit - stamps.length, retryAfterMs: 0 };
    },
    reset(key) {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    },
    get size() {
      return hits.size;
    },
  };
}
