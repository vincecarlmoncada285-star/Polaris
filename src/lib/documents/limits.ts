import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

/**
 * Pages of the data export a user may ask for in an hour. Exporting 500 documents takes 25
 * pages or more, so this allows several full exports, but not one account reading the
 * database flat out.
 */
export const EXPORT_PAGES_PER_HOUR = 300;

export function createExportLimiter(now?: () => number): RateLimiter {
  return createRateLimiter({ limit: EXPORT_PAGES_PER_HOUR, windowMs: 60 * 60_000, now });
}

const globalForLimits = globalThis as unknown as { polarisExportLimiter?: RateLimiter };

export const exportLimiter: RateLimiter = (globalForLimits.polarisExportLimiter ??=
  createExportLimiter());
