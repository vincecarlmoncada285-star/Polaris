import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ReviewResult } from "@/lib/ai/protocol";
import type { DocBlock } from "./blocks";

/** Older reviews of a document are deleted when a new one is saved. */
export const MAX_REVIEWS_PER_DOCUMENT = 5;

/**
 * sha256 of the reviewed text, block by block, with each block's heading level: how a review
 * knows whether the document changed. Any edit to the text changes it, and so does turning a
 * paragraph into a heading or back, which leaves the plain text alone but renumbers the [P]
 * paragraphs the review points to. The title and goals are not part of it.
 */
export function contentHash(blocks: readonly DocBlock[]): string {
  const canonical = JSON.stringify(blocks.map((b) => [b.heading, b.text]));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface StoredReview {
  id: string;
  documentId: string;
  createdAt: string;
  model: string;
  promptVersion: string;
  wordCount: number;
  contentHash: string;
  result: ReviewResult;
}

export interface NewReview {
  model: string;
  promptVersion: string;
  wordCount: number;
  contentHash: string;
  result: ReviewResult;
}

type Row = Awaited<ReturnType<PrismaClient["documentReview"]["findFirstOrThrow"]>>;

function toStored(row: Row): StoredReview | null {
  let result: ReviewResult;
  try {
    result = JSON.parse(row.result) as ReviewResult;
  } catch {
    return null;
  }
  return {
    id: row.id,
    documentId: row.documentId,
    createdAt: row.createdAt.toISOString(),
    model: row.model,
    promptVersion: row.promptVersion,
    wordCount: row.wordCount,
    contentHash: row.contentHash,
    result,
  };
}

// Like the document service: every method takes the user first and scopes every query by it,
// so another user's document has no reviews to read and cannot be given one.
export function createReviewService(db: PrismaClient) {
  return {
    /** The newest review of the user's document, or null (none yet, or not their document). */
    async latest(userId: string, documentId: string): Promise<StoredReview | null> {
      const row = await db.documentReview.findFirst({
        where: { documentId, userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return row ? toStored(row) : null;
    },

    /**
     * Saves a review of the user's document and deletes all but the newest
     * MAX_REVIEWS_PER_DOCUMENT, in one transaction. Null if the document is not theirs.
     */
    async save(userId: string, documentId: string, input: NewReview): Promise<StoredReview | null> {
      const row = await db.$transaction(async (tx) => {
        const owned = await tx.document.findFirst({
          where: { id: documentId, userId },
          select: { id: true },
        });
        if (!owned) return null;
        const created = await tx.documentReview.create({
          data: { ...input, documentId, userId, result: JSON.stringify(input.result) },
        });
        const older = await tx.documentReview.findMany({
          where: { documentId, id: { not: created.id } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: MAX_REVIEWS_PER_DOCUMENT - 1,
          select: { id: true },
        });
        if (older.length) {
          await tx.documentReview.deleteMany({ where: { id: { in: older.map((r) => r.id) } } });
        }
        return created;
      });
      return row ? toStored(row) : null;
    },

    /** How many reviews the user's document has (for tests and monitoring). */
    async count(userId: string, documentId: string): Promise<number> {
      return db.documentReview.count({ where: { documentId, userId } });
    },
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
