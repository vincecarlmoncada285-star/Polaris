import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * A whole-server ceiling a day, from the environment (a positive integer; anything else means
 * the default). The per-user limits stop one account; these stop many accounts together,
 * since anyone can sign up on an open server and every request is paid from the operator's key.
 */
export function serverDailyCap(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const DEFAULT_SERVER_PARAGRAPHS_PER_DAY = 20_000;
export const DEFAULT_SERVER_REVIEWS_PER_DAY = 500;

/** Why a request was refused: the writer's own allowance, or the whole server's. */
export type AiRefusal = { ok: false; retryAfterMs: number; scope: "user" | "server" };

export interface AiLimits {
  perMinute: RateLimiter;
  perDay: RateLimiter;
  /** Every user together (POLARIS_AI_DAILY_PARAGRAPHS). */
  server: RateLimiter;
  /** Records one request that will reach Claude. */
  check(userId: string): { ok: true } | AiRefusal;
  reset(): void;
}

/**
 * Per user: 30 requests a minute (a burst of edits) and 600 a day. Per server: 20,000 a day
 * unless POLARIS_AI_DAILY_PARAGRAPHS says otherwise.
 */
export function createAiLimits(
  now?: () => number,
  serverPerDay = serverDailyCap(
    process.env.POLARIS_AI_DAILY_PARAGRAPHS,
    DEFAULT_SERVER_PARAGRAPHS_PER_DAY,
  ),
): AiLimits {
  const perMinute = createRateLimiter({ limit: 30, windowMs: MINUTE, now });
  const perDay = createRateLimiter({ limit: 600, windowMs: DAY, now });
  const server = createRateLimiter({ limit: serverPerDay, windowMs: DAY, now });
  return {
    perMinute,
    perDay,
    server,
    check(userId) {
      // Per minute first, so a burst the minute limit refuses does not use up the day, and the
      // user's own limits before the server's, so one user's refused requests use none of it.
      const minute = perMinute.hit(userId);
      if (!minute.ok) return { ok: false, retryAfterMs: minute.retryAfterMs, scope: "user" };
      const day = perDay.hit(userId);
      if (!day.ok) return { ok: false, retryAfterMs: day.retryAfterMs, scope: "user" };
      const all = server.hit("server");
      if (!all.ok) return { ok: false, retryAfterMs: all.retryAfterMs, scope: "server" };
      return { ok: true };
    },
    reset() {
      perMinute.reset();
      perDay.reset();
      server.reset();
    },
  };
}

const globalForLimits = globalThis as unknown as { polarisAiLimits?: AiLimits };

export const aiLimits: AiLimits = (globalForLimits.polarisAiLimits ??= createAiLimits());

const HOUR = 60 * MINUTE;

export interface ReviewLimits {
  perHour: RateLimiter;
  perDay: RateLimiter;
  /** Every user together (POLARIS_AI_DAILY_REVIEWS). */
  server: RateLimiter;
  /** Records one review that will reach Claude. */
  check(userId: string): { ok: true } | AiRefusal;
  reset(): void;
}

/**
 * Per user: 6 reviews an hour and 30 a day. A review reads the whole document at high effort,
 * so it costs far more than a paragraph; these allow revising and asking again several times
 * in a session.
 */
export function createReviewLimits(
  now?: () => number,
  serverPerDay = serverDailyCap(
    process.env.POLARIS_AI_DAILY_REVIEWS,
    DEFAULT_SERVER_REVIEWS_PER_DAY,
  ),
): ReviewLimits {
  const perHour = createRateLimiter({ limit: 6, windowMs: HOUR, now });
  const perDay = createRateLimiter({ limit: 30, windowMs: DAY, now });
  const server = createRateLimiter({ limit: serverPerDay, windowMs: DAY, now });
  return {
    perHour,
    perDay,
    server,
    check(userId) {
      // The shorter window first, so a refused burst does not use up the day; the server's
      // allowance last, so a user's refused reviews use none of it.
      const hour = perHour.hit(userId);
      if (!hour.ok) return { ok: false, retryAfterMs: hour.retryAfterMs, scope: "user" };
      const day = perDay.hit(userId);
      if (!day.ok) return { ok: false, retryAfterMs: day.retryAfterMs, scope: "user" };
      const all = server.hit("server");
      if (!all.ok) return { ok: false, retryAfterMs: all.retryAfterMs, scope: "server" };
      return { ok: true };
    },
    reset() {
      perHour.reset();
      perDay.reset();
      server.reset();
    },
  };
}

const globalForReviewLimits = globalThis as unknown as { polarisReviewLimits?: ReviewLimits };

export const reviewLimits: ReviewLimits = (globalForReviewLimits.polarisReviewLimits ??=
  createReviewLimits());
