import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Model and effort are chosen here and nowhere else.

type Env = Record<string, string | undefined>;
/** The exact model id: Claude model ids are complete as is, never add a date suffix. */
export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export const PARAGRAPH_EFFORTS = ["low", "medium", "high"] as const;
export type ParagraphEffort = (typeof PARAGRAPH_EFFORTS)[number];

/** `POLARIS_AI_MODEL`, or the default. */
export function aiModel(env: Env = process.env): string {
  return env.POLARIS_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

let warnedEffort = false;

/**
 * `POLARIS_AI_PARAGRAPH_EFFORT` (low | medium | high), default "low": paragraph feedback is
 * high-volume and latency-sensitive, and runs on every pause in typing.
 */
export function paragraphEffort(env: Env = process.env): ParagraphEffort {
  const raw = env.POLARIS_AI_PARAGRAPH_EFFORT?.trim().toLowerCase();
  if (!raw) return "low";
  if ((PARAGRAPH_EFFORTS as readonly string[]).includes(raw)) return raw as ParagraphEffort;
  if (!warnedEffort) {
    warnedEffort = true;
    console.warn("[ai] POLARIS_AI_PARAGRAPH_EFFORT must be low, medium or high; using low.");
  }
  return "low";
}

export const REVIEW_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReviewEffort = (typeof REVIEW_EFFORTS)[number];

let warnedReviewEffort = false;

/**
 * `POLARIS_AI_REVIEW_EFFORT` (low | medium | high | xhigh | max), default "high": a review is
 * asked for rarely, reads the whole document and is worth the time; the model's own default
 * would be lower.
 */
export function reviewEffort(env: Env = process.env): ReviewEffort {
  const raw = env.POLARIS_AI_REVIEW_EFFORT?.trim().toLowerCase();
  if (!raw) return "high";
  if ((REVIEW_EFFORTS as readonly string[]).includes(raw)) return raw as ReviewEffort;
  if (!warnedReviewEffort) {
    warnedReviewEffort = true;
    console.warn(
      "[ai] POLARIS_AI_REVIEW_EFFORT must be low, medium, high, xhigh or max; using high.",
    );
  }
  return "high";
}

/** Haiku models have no server-side refusal fallback, so the request must not ask for one. */
export function supportsServerSideFallback(model: string): boolean {
  return !model.startsWith("claude-haiku");
}

/** True when the server has Anthropic credentials. Says nothing about whether they work. */
export function isAiConfigured(env: Env = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());
}

let client: Anthropic | undefined;

/**
 * The shared client, created on first use (so importing this module never needs a key).
 * Reads ANTHROPIC_API_KEY from the environment. One retry and a minute's timeout: a writer
 * waiting on suggestions is better served by a quick failure than a long hang. For a streamed
 * request (the review), the timeout covers the wait for the response to start, not the stream.
 */
export function getAnthropicClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
  return client;
}
