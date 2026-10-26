import { NextResponse } from "next/server";
import { aiModel, getAnthropicClient, isAiConfigured, reviewEffort } from "@/lib/ai/client";
import { reviewLimits } from "@/lib/ai/limits";
import {
  REVIEW_MAX_CHARS,
  REVIEW_MAX_WORDS,
  REVIEW_MIN_WORDS,
  type DocumentReviewDTO,
  type ReviewResponse,
} from "@/lib/ai/protocol";
import { REVIEW_PROMPT_VERSION, requestDocumentReview } from "@/lib/ai/review";
import {
  errorResponse as fail,
  retryAfterSeconds,
  upstreamErrorResponse,
  type UpstreamMessages,
} from "@/lib/ai/route-errors";
import { requireUser } from "@/lib/auth/session";
import { documents, reviews } from "@/lib/documents";
import { blocksFootnotes, blocksText, reviewBlocks } from "@/lib/documents/blocks";
import { contentHash, type StoredReview } from "@/lib/documents/reviews";
import { users } from "@/lib/users";
import { countWords } from "@/lib/text/stats";
import { crossSiteRefusal } from "@/lib/http/request";

// A review of a long document at high effort can take minutes.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// Also the answer for another user's document: a 403 would confirm that the id exists.
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

const UNAVAILABLE = "Reviews by Claude aren't set up on this server.";

const UPSTREAM: UpstreamMessages = {
  label: "[ai/review]",
  unavailable: UNAVAILABLE,
  failed: "Claude couldn't finish the review just now. Try again in a few minutes.",
  rateLimited: "Claude is busy right now. Try the review again in a moment.",
};

function toDTO(review: StoredReview, stale: boolean): DocumentReviewDTO {
  return {
    id: review.id,
    createdAt: review.createdAt,
    model: review.model,
    wordCount: review.wordCount,
    stale,
    result: review.result,
  };
}

/** The latest review of the document, and whether the document has changed since. */
export async function GET(_req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const doc = await documents.get(userId, (await params).id);
  if (!doc) return notFound();
  const latest = await reviews.latest(userId, doc.id);
  if (!latest) return fail(404, "This document has not been reviewed yet.", "none");
  const stale = latest.contentHash !== contentHash(reviewBlocks(doc));
  return NextResponse.json({ review: toDTO(latest, stale) } satisfies ReviewResponse);
}

/**
 * Asks Claude to review the whole document as last saved (title, goals and text), saves the
 * review and returns it. No body: the document is read from the database. Only for writers
 * who switched AI on.
 */
export async function POST(req: Request, { params }: Ctx) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const crossSite = crossSiteRefusal(req);
  if (crossSite) return crossSite;
  const doc = await documents.get(userId, (await params).id);
  if (!doc) return notFound();
  // Read from the database rather than the session token, so switching AI off takes effect
  // on the very next request.
  const user = await users.getUser(userId);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.aiEnabled) {
    return fail(403, "AI is off. Turn it on in Settings to ask for a review.", "ai_disabled");
  }
  if (!isAiConfigured()) return fail(503, UNAVAILABLE, "ai_unavailable");

  // Measured on exactly what would be sent: the prompt is built from the stored JSON, which
  // is saved alongside the plain text but not checked against it.
  const blocks = reviewBlocks(doc);
  const reviewedText = blocksText(blocks);
  const wordCount = countWords(reviewedText);
  if (wordCount < REVIEW_MIN_WORDS) {
    return fail(
      422,
      `A review needs at least ${REVIEW_MIN_WORDS} words; this document has ${wordCount.toLocaleString("en-US")}.`,
      "too_short",
    );
  }
  if (wordCount > REVIEW_MAX_WORDS) {
    return fail(
      413,
      `A review can cover up to ${REVIEW_MAX_WORDS.toLocaleString("en-US")} words; this document has ${wordCount.toLocaleString("en-US")}.`,
      "too_long",
    );
  }
  // Footnotes are sent too, so they count towards the characters (not the words).
  const chars = blocksFootnotes(blocks).reduce((n, f) => n + f.length, reviewedText.length);
  if (chars > REVIEW_MAX_CHARS) {
    return fail(
      413,
      `A review can cover up to ${REVIEW_MAX_CHARS.toLocaleString("en-US")} characters; this document has ${chars.toLocaleString("en-US")}.`,
      "too_long",
    );
  }

  const limit = reviewLimits.check(userId);
  if (!limit.ok) {
    const server = limit.scope === "server";
    const message = server
      ? "Reviews have reached this server's limit for today. Try again tomorrow."
      : "You have asked for several reviews recently.";
    return fail(429, message, server ? "server_limit" : "rate_limited", {
      "Retry-After": retryAfterSeconds(limit.retryAfterMs),
    });
  }

  const model = aiModel();
  const effort = reviewEffort();
  try {
    const outcome = await requestDocumentReview(
      getAnthropicClient(),
      { title: doc.title, goals: doc.goals, blocks, plainText: reviewedText, wordCount },
      { model, effort, signal: req.signal },
    );
    // Cancelled while the answer arrived: the writer no longer wants it, so keep nothing.
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    if (outcome.refused) {
      return fail(
        422,
        "Claude declined to review this document. Nothing is wrong with your account; the rule-based suggestions and the Overview still work.",
        "refused",
      );
    }
    const saved = await reviews.save(userId, doc.id, {
      model: outcome.model,
      promptVersion: REVIEW_PROMPT_VERSION,
      wordCount,
      contentHash: contentHash(blocks),
      result: outcome.result,
    });
    // Deleted while Claude was reading it.
    if (!saved) return notFound();
    return NextResponse.json({ review: toDTO(saved, false) } satisfies ReviewResponse, {
      status: 201,
    });
  } catch (e) {
    return upstreamErrorResponse(e, req.signal, UPSTREAM);
  }
}
