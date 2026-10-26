import { NextResponse } from "next/server";
import { feedbackCacheKey, paragraphFeedbackCache, type CachedFeedback } from "@/lib/ai/cache";
import { aiModel, getAnthropicClient, isAiConfigured, paragraphEffort } from "@/lib/ai/client";
import { aiLimits } from "@/lib/ai/limits";
import { PROMPT_VERSION, requestParagraphFeedback } from "@/lib/ai/paragraph";
import { paragraphRequestSchema, type ParagraphResponse } from "@/lib/ai/protocol";
import {
  errorResponse as fail,
  retryAfterSeconds,
  upstreamErrorResponse,
  type UpstreamMessages,
} from "@/lib/ai/route-errors";
import { requireUser } from "@/lib/auth/session";
import { crossSiteRefusal, readBody } from "@/lib/http/request";
import { users } from "@/lib/users";

// Room for a 4000-character paragraph and previous paragraph, the title and JSON escaping.
const MAX_BODY_CHARS = 40_000;
// The same room in UTF-8 (at most 4 bytes a character), enforced while the body arrives.
const MAX_BODY_BYTES = MAX_BODY_CHARS * 4;

const UNAVAILABLE = "AI suggestions aren't set up on this server.";
const RATE_LIMITED = "Too many AI requests. Try again in a moment.";

const UPSTREAM: UpstreamMessages = {
  label: "[ai/paragraph]",
  unavailable: UNAVAILABLE,
  failed: "AI suggestions are unavailable right now. Try again later.",
  rateLimited: RATE_LIMITED,
};

/**
 * Body: { text, goals, title?, previous? }. Claude's suggestions for one paragraph, anchored
 * to offsets in `text`. Only for writers who switched AI suggestions on.
 */
export async function POST(req: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const crossSite = crossSiteRefusal(req);
  if (crossSite) return crossSite;
  if (!/^application\/json\s*(?:;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return fail(415, "Send the request as JSON.");
  }
  // Read from the database rather than the session token, so switching AI off takes effect
  // on the very next request.
  const user = await users.getUser(userId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.aiEnabled) {
    return fail(403, "AI suggestions are off. Turn them on in Settings.", "ai_disabled");
  }
  if (!isAiConfigured()) return fail(503, UNAVAILABLE, "ai_unavailable");

  const read = await readBody(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.status === 413
      ? fail(413, "This paragraph is too long for AI suggestions.")
      : fail(400, "Could not read the request.");
  }
  const raw = read.text;
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
    const message =
      limit.scope === "server"
        ? "AI suggestions have reached this server's limit for today. They will be back tomorrow."
        : RATE_LIMITED;
    return fail(429, message, limit.scope === "server" ? "server_limit" : "rate_limited", {
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
    return upstreamErrorResponse(e, req.signal, UPSTREAM);
  }
}
