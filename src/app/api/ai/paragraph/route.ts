import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { feedbackCacheKey, paragraphFeedbackCache, type CachedFeedback } from "@/lib/ai/cache";
import { aiModel, getAnthropicClient, isAiConfigured, paragraphEffort } from "@/lib/ai/client";
import { aiLimits } from "@/lib/ai/limits";
import { AiOutputError, PROMPT_VERSION, requestParagraphFeedback } from "@/lib/ai/paragraph";
import {
  paragraphRequestSchema,
  type AiErrorBody,
  type AiErrorCode,
  type ParagraphResponse,
} from "@/lib/ai/protocol";
import { requireUser } from "@/lib/auth/session";
import { users } from "@/lib/users";

// Room for a 4000-character paragraph and previous paragraph, the title and JSON escaping.
const MAX_BODY_CHARS = 40_000;

const UNAVAILABLE = "AI suggestions aren't set up on this server.";
const UPSTREAM_FAILED = "AI suggestions are unavailable right now. Try again later.";

function fail(status: number, error: string, code?: AiErrorCode, headers?: HeadersInit) {
  const body: AiErrorBody = code ? { error, code } : { error };
  return NextResponse.json(body, { status, headers });
}

const retryAfterSeconds = (ms: number) => String(Math.max(1, Math.ceil(ms / 1000)));

/**
 * What may be logged about a failed upstream call: a fixed label, the HTTP status and the
 * request id. Never the error message, the prompt or the model's output.
 */
function logUpstream(
  level: "warn" | "error",
  label: string,
  e?: InstanceType<typeof Anthropic.APIError>,
) {
  console[level]("[ai/paragraph]", label, {
    status: e?.status ?? null,
    requestId: e?.requestID ?? null,
  });
}

/** Maps an error from the Claude call to a response, most specific class first. */
function upstreamError(e: unknown, signal: AbortSignal): Response {
  if (e instanceof Anthropic.APIUserAbortError || signal.aborted) {
    // The writer edited the paragraph again (or left), so the client cancelled. Nobody is
    // waiting for this response and nothing went wrong: no body, no log.
    return new NextResponse(null, { status: 499 });
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    logUpstream(
      "warn",
      "Anthropic rejected the configured credentials; check ANTHROPIC_API_KEY",
      e,
    );
    return fail(503, UNAVAILABLE, "ai_unavailable");
  }
  if (e instanceof Anthropic.RateLimitError) {
    logUpstream("warn", "Anthropic rate limit reached", e);
    const upstream = Number(e.headers?.get("retry-after"));
    const seconds = Number.isFinite(upstream) && upstream > 0 ? String(Math.ceil(upstream)) : "30";
    return fail(429, "Too many AI requests. Try again in a moment.", "rate_limited", {
      "Retry-After": seconds,
    });
  }
  if (e instanceof Anthropic.APIConnectionError) {
    logUpstream("warn", "Could not reach the Anthropic API", e);
    return fail(502, UPSTREAM_FAILED, "ai_error");
  }
  if (e instanceof Anthropic.APIError) {
    logUpstream("error", "Anthropic API error", e);
    return fail(502, UPSTREAM_FAILED, "ai_error");
  }
  if (e instanceof AiOutputError) {
    console.warn("[ai/paragraph]", "Unusable model output", { reason: e.reason });
    return fail(502, UPSTREAM_FAILED, "ai_error");
  }
  console.error("[ai/paragraph]", "Unexpected error while requesting feedback");
  return fail(500, UPSTREAM_FAILED, "ai_error");
}

/**
 * Body: { text, goals, title?, previous? }. Claude's suggestions for one paragraph, anchored
 * to offsets in `text`. Only for writers who switched AI suggestions on.
 */
export async function POST(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  // Read from the database rather than the session token, so switching AI off takes effect
  // on the very next request.
  const user = await users.getUser(userId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.aiEnabled) {
    return fail(403, "AI suggestions are off. Turn them on in Settings.", "ai_disabled");
  }
  if (!isAiConfigured()) return fail(503, UNAVAILABLE, "ai_unavailable");

  const raw = await req.text().catch(() => null);
  if (raw === null) return fail(400, "Could not read the request.");
  if (raw.length > MAX_BODY_CHARS)
    return fail(413, "This paragraph is too long for AI suggestions.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(400, "The request is not valid JSON.");
  }
  const parsed = paragraphRequestSchema.safeParse(json);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.code === "too_big")) {
      return fail(413, "This paragraph is too long for AI suggestions.");
    }
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { text, goals } = parsed.data;
  // Blank context is no context: it neither reaches the prompt nor splits the cache.
  const title = parsed.data.title?.trim() || undefined;
  const previous = parsed.data.previous?.trim() ? parsed.data.previous : undefined;

  const model = aiModel();
  const effort = paragraphEffort();
  const key = feedbackCacheKey({
    model,
    effort,
    promptVersion: PROMPT_VERSION,
    goals,
    text,
    title,
    previous,
  });
  const hit = paragraphFeedbackCache.get(key);
  if (hit) return NextResponse.json({ ...hit, cached: true } satisfies ParagraphResponse);

  // Only requests that will reach Claude count: a cached answer costs nothing.
  const limit = aiLimits.check(userId);
  if (!limit.ok) {
    return fail(429, "Too many AI requests. Try again in a moment.", "rate_limited", {
      "Retry-After": retryAfterSeconds(limit.retryAfterMs),
    });
  }

  try {
    const result = await requestParagraphFeedback(
      getAnthropicClient(),
      { text, goals, title, previous },
      { model, effort, signal: req.signal },
    );
    const value: CachedFeedback = result.refused
      ? { suggestions: [], refused: true }
      : { suggestions: result.suggestions };
    paragraphFeedbackCache.set(key, value);
    return NextResponse.json({ ...value, cached: false } satisfies ParagraphResponse);
  } catch (e) {
    return upstreamError(e, req.signal);
  }
}
