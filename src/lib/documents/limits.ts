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

/**
 * How much one account may store, so that one account (sign-up is open by default) cannot
 * fill the disk every other writer's documents share. Generous for real use: a
 * 100,000-word thesis is about 2 M characters of content and plain text together.
 */
export const MAX_DOCUMENTS_PER_USER = 1000;
export const MAX_STORED_CHARS_PER_USER = 200_000_000;
/** Saves at least this large check the account's total first; smaller ones cannot add much. */
export const LARGE_SAVE_CHARS = 1_000_000;

/** New documents per user per hour (an import is one). */
export const CREATES_PER_HOUR = 120;
/** Saves per user per minute: typing saves about once a second at most, per open tab. */
export const SAVES_PER_MINUTE = 240;

export function createDocumentWriteLimiters(now?: () => number) {
  return {
    creates: createRateLimiter({ limit: CREATES_PER_HOUR, windowMs: 60 * 60_000, now }),
    saves: createRateLimiter({ limit: SAVES_PER_MINUTE, windowMs: 60_000, now }),
  };
}

const globalForWrites = globalThis as unknown as {
  polarisDocumentWrites?: ReturnType<typeof createDocumentWriteLimiters>;
};

export const documentWrites = (globalForWrites.polarisDocumentWrites ??=
  createDocumentWriteLimiters());
