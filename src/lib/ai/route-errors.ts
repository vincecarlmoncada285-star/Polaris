// Responses for the AI routes when the Claude call fails, shared so both map the SDK's errors
// the same way. Server only.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { ReviewErrorCode } from "./protocol";
import { AiOutputError } from "./structured";

export function errorResponse(
  status: number,
  error: string,
  code?: ReviewErrorCode,
  headers?: HeadersInit,
) {
  return NextResponse.json(code ? { error, code } : { error }, { status, headers });
}

export const retryAfterSeconds = (ms: number) => String(Math.max(1, Math.ceil(ms / 1000)));

export interface UpstreamMessages {
  /** Log prefix, such as "[ai/paragraph]". */
  label: string;
  /** For the writer, when the server's credentials are refused. */
  unavailable: string;
  /** For the writer, when the call failed some other way. */
  failed: string;
  /** For the writer, when Anthropic's rate limit was reached. */
  rateLimited: string;
}

/**
 * What may be logged about a failed upstream call: a fixed label, the HTTP status and the
 * request id. Never the error message, the prompt or the model's output.
 */
function logUpstream(
  m: UpstreamMessages,
  level: "warn" | "error",
  text: string,
  e?: InstanceType<typeof Anthropic.APIError>,
) {
  console[level](m.label, text, {
    status: e?.status ?? null,
    requestId: e?.requestID ?? null,
  });
}

/** Maps an error from the Claude call to a response, most specific class first. */
export function upstreamErrorResponse(
  e: unknown,
  signal: AbortSignal,
  m: UpstreamMessages,
): Response {
  if (e instanceof Anthropic.APIUserAbortError || signal.aborted) {
    // The client cancelled (an edit, a Cancel button, a closed tab). Nobody is waiting for
    // this response and nothing went wrong: no body, no log.
    return new NextResponse(null, { status: 499 });
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    logUpstream(
      m,
      "warn",
      "Anthropic rejected the configured credentials; check ANTHROPIC_API_KEY",
      e,
    );
    return errorResponse(503, m.unavailable, "ai_unavailable");
  }
  if (e instanceof Anthropic.RateLimitError) {
    logUpstream(m, "warn", "Anthropic rate limit reached", e);
    const upstream = Number(e.headers?.get("retry-after"));
    const seconds = Number.isFinite(upstream) && upstream > 0 ? String(Math.ceil(upstream)) : "30";
    return errorResponse(429, m.rateLimited, "rate_limited", { "Retry-After": seconds });
  }
  if (e instanceof Anthropic.APIConnectionError) {
    logUpstream(m, "warn", "Could not reach the Anthropic API", e);
    return errorResponse(502, m.failed, "ai_error");
  }
  if (e instanceof Anthropic.APIError) {
    logUpstream(m, "error", "Anthropic API error", e);
    return errorResponse(502, m.failed, "ai_error");
  }
  if (e instanceof AiOutputError) {
    console.warn(m.label, "Unusable model output", { reason: e.reason });
    return errorResponse(502, m.failed, "ai_error");
  }
  console.error(m.label, "Unexpected error while calling Claude");
  return errorResponse(500, m.failed, "ai_error");
}
