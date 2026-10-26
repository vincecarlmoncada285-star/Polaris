import { NextResponse } from "next/server";
import { documents } from "./index";
import {
  documentWrites,
  LARGE_SAVE_CHARS,
  MAX_DOCUMENTS_PER_USER,
  MAX_STORED_CHARS_PER_USER,
} from "./limits";
import { MAX_CONTENT_BYTES } from "./schema";

/**
 * Room for the largest document an update accepts (content and plain text, each up to
 * MAX_CONTENT_BYTES characters), its JSON escaping and UTF-8 (up to 3 bytes a character).
 * Enforced while the body arrives, before anything is parsed.
 */
export const DOCUMENT_BODY_BYTES = 32 * 1024 * 1024;
// Keep the cap above what the schema allows, or valid saves would be cut off.
if (DOCUMENT_BODY_BYTES < 2 * MAX_CONTENT_BYTES) throw new Error("DOCUMENT_BODY_BYTES too small");

const refuse = (status: number, error: string, code: string, retryAfterMs?: number) =>
  NextResponse.json(
    { error, code },
    {
      status,
      headers: retryAfterMs ? { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } : {},
    },
  );

const sizeOf = (input: { content?: unknown; plainText?: string }) =>
  (input.content === undefined ? 0 : JSON.stringify(input.content).length) +
  (input.plainText?.length ?? 0);

/** Null if the user may create this document; otherwise the response that says why not. */
export async function refuseCreate(
  userId: string,
  input: { content?: unknown; plainText?: string },
): Promise<NextResponse | null> {
  const limited = documentWrites.creates.hit(userId);
  if (!limited.ok) {
    return refuse(
      429,
      "You have created a lot of documents. Try again later.",
      "rate_limited",
      limited.retryAfterMs,
    );
  }
  const usage = await documents.usage(userId);
  if (usage.documents >= MAX_DOCUMENTS_PER_USER) {
    return refuse(
      403,
      `You have reached the limit of ${MAX_DOCUMENTS_PER_USER} documents. Delete some to make room.`,
      "document_limit",
    );
  }
  if (usage.chars + sizeOf(input) > MAX_STORED_CHARS_PER_USER) {
    return refuse(403, "Your documents have reached this server's storage limit.", "storage_limit");
  }
  return null;
}

/** Null if the user may save this update to `id`; otherwise the response that says why not. */
export async function refuseSave(
  userId: string,
  id: string,
  input: { content?: unknown; plainText?: string },
): Promise<NextResponse | null> {
  const limited = documentWrites.saves.hit(userId);
  if (!limited.ok) {
    return refuse(
      429,
      "Saving too often. Polaris will try again in a moment.",
      "rate_limited",
      limited.retryAfterMs,
    );
  }
  // Only a large save can add much to the account's total, so only those pay for the check.
  // The document's current text is what the save replaces, so it is not counted twice (the
  // editor always saves content and plain text together).
  const size = sizeOf(input);
  if (size >= LARGE_SAVE_CHARS) {
    const usage = await documents.usage(userId, id);
    if (usage.chars + size > MAX_STORED_CHARS_PER_USER) {
      return refuse(
        403,
        "Your documents have reached this server's storage limit.",
        "storage_limit",
      );
    }
  }
  return null;
}
