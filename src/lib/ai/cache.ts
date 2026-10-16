import { createHash } from "node:crypto";
import type { WritingGoals } from "@/lib/documents/schema";
import type { AiSuggestion } from "./protocol";

export interface CachedFeedback {
  suggestions: AiSuggestion[];
  refused?: true;
}

export interface FeedbackCache {
  get(key: string): CachedFeedback | undefined;
  set(key: string, value: CachedFeedback): void;
  clear(): void;
  readonly size: number;
}

const DAY = 24 * 60 * 60_000;

/** In-memory LRU with a time-to-live. Per process, like the rate limiters. */
export function createFeedbackCache({
  ttlMs = DAY,
  capacity = 2000,
  now = Date.now,
}: { ttlMs?: number; capacity?: number; now?: () => number } = {}): FeedbackCache {
  // Insertion order is recency order: hits are re-inserted, so the first key is the LRU.
  const entries = new Map<string, { value: CachedFeedback; expires: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expires <= now()) return undefined;
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** JSON with object keys sorted at every level, so equal goals always serialize the same. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface FeedbackKeyInput {
  model: string;
  effort: string;
  promptVersion: string;
  goals: WritingGoals;
  text: string;
  /** Context sent with the paragraph. Part of the prompt, so part of the key. */
  title?: string;
  previous?: string;
}

/** sha256 over everything that shapes the answer. The paragraph text never appears in a key. */
export function feedbackCacheKey(input: FeedbackKeyInput): string {
  const parts = [
    input.model,
    input.effort,
    input.promptVersion,
    stableJson(input.goals),
    input.text,
    input.title ?? "",
    input.previous ?? "",
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

const globalForCache = globalThis as unknown as { polarisFeedbackCache?: FeedbackCache };

/** Shared by every request in this process (and across dev hot reloads). */
export const paragraphFeedbackCache: FeedbackCache = (globalForCache.polarisFeedbackCache ??=
  createFeedbackCache());
