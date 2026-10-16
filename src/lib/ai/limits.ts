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

const HOUR = 60 * MINUTE;

export interface ReviewLimits {
  perHour: RateLimiter;
  perDay: RateLimiter;
  /** Records one review that will reach Claude. */
  check(userId: string): { ok: true } | { ok: false; retryAfterMs: number };
  reset(): void;
}

/**
 * Per user: 6 reviews an hour and 30 a day. A review reads the whole document at high effort,
 * so it costs far more than a paragraph; these allow revising and asking again several times
 * in a session.
 */
export function createReviewLimits(now?: () => number): ReviewLimits {
  const perHour = createRateLimiter({ limit: 6, windowMs: HOUR, now });
  const perDay = createRateLimiter({ limit: 30, windowMs: DAY, now });
  return {
    perHour,
    perDay,
    check(userId) {
      // The shorter window first, so a refused burst does not use up the day.
      const hour = perHour.hit(userId);
      if (!hour.ok) return { ok: false, retryAfterMs: hour.retryAfterMs };
      const day = perDay.hit(userId);
      if (!day.ok) return { ok: false, retryAfterMs: day.retryAfterMs };
      return { ok: true };
    },
    reset() {
      perHour.reset();
      perDay.reset();
    },
  };
}

const globalForReviewLimits = globalThis as unknown as { polarisReviewLimits?: ReviewLimits };

export const reviewLimits: ReviewLimits = (globalForReviewLimits.polarisReviewLimits ??=
  createReviewLimits());
