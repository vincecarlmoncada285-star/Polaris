import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface AiLimits {
  perMinute: RateLimiter;
  perDay: RateLimiter;
  /** Records one request that will reach Claude. */
  check(userId: string): { ok: true } | { ok: false; retryAfterMs: number };
  reset(): void;
}

/** Per user: 30 requests a minute (a burst of edits) and 600 a day (cost ceiling). */
export function createAiLimits(now?: () => number): AiLimits {
  const perMinute = createRateLimiter({ limit: 30, windowMs: MINUTE, now });
  const perDay = createRateLimiter({ limit: 600, windowMs: DAY, now });
  return {
    perMinute,
    perDay,
    check(userId) {
      // Per minute first, so a burst the minute limit refuses does not use up the day.
      const minute = perMinute.hit(userId);
      if (!minute.ok) return { ok: false, retryAfterMs: minute.retryAfterMs };
      const day = perDay.hit(userId);
      if (!day.ok) return { ok: false, retryAfterMs: day.retryAfterMs };
      return { ok: true };
    },
    reset() {
      perMinute.reset();
      perDay.reset();
    },
  };
}

const globalForLimits = globalThis as unknown as { polarisAiLimits?: AiLimits };

export const aiLimits: AiLimits = (globalForLimits.polarisAiLimits ??= createAiLimits());
