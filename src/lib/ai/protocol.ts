// The AI routes' contracts (POST /api/ai/paragraph, and the document review), shared by the
// routes and the editor. Client-safe: no SDK, no server-only imports.
import { z } from "zod";
import { writingGoalsSchema, type WritingGoals } from "@/lib/documents/schema";
import type { Category } from "@/lib/rules/types";

export const AI_PARAGRAPH_ENDPOINT = "/api/ai/paragraph";
export const AI_MAX_PARAGRAPH_CHARS = 4000;
export const AI_MAX_TITLE_CHARS = 200;

export const paragraphRequestSchema = z
  .object({
    text: z
      .string()
      .max(AI_MAX_PARAGRAPH_CHARS)
      .refine((t) => t.trim().length > 0, { message: "Text is empty" }),
    goals: writingGoalsSchema,
    /** Context only: the document title. */
    title: z.string().max(AI_MAX_TITLE_CHARS).optional(),
    /** Context only: the paragraph before this one. */
    previous: z.string().max(AI_MAX_PARAGRAPH_CHARS).optional(),
  })
  .strict();

export type ParagraphRequest = z.infer<typeof paragraphRequestSchema>;

/** One suggestion, anchored to `text`. Offsets are UTF-16 indices, end-exclusive. */
export interface AiSuggestion {
  start: number;
  end: number;
  category: Category;
  message: string;
  explanation: string;
  /** At most one entry; empty means "rephrase this yourself". */
  replacements: string[];
}

export interface ParagraphResponse {
  suggestions: AiSuggestion[];
  /** Claude declined to review this paragraph; treated as "no suggestions". */
  refused?: true;
  cached: boolean;
}

export type AiErrorCode = "ai_disabled" | "ai_unavailable" | "rate_limited" | "ai_error";

export interface AiErrorBody {
  error: string;
  code?: AiErrorCode;
}

// The whole-document review: POST and GET /api/documents/[id]/review.

/** Below this, there is not enough of an argument to review. */
export const REVIEW_MIN_WORDS = 150;
/** Above this, the document no longer fits a review's budget. */
export const REVIEW_MAX_WORDS = 60_000;
/**
 * The same budget in characters (10 a word, far more than prose needs), so a document of a
 * few enormous "words" cannot slip past the word limit.
 */
export const REVIEW_MAX_CHARS = 600_000;

export const reviewEndpoint = (documentId: string) =>
  `/api/documents/${encodeURIComponent(documentId)}/review`;

export const REVIEW_CATEGORIES = [
  "structure",
  "argument",
  "evidence",
  "clarity",
  "style",
  "citations",
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  structure: "Structure",
  argument: "Argument",
  evidence: "Evidence",
  clarity: "Clarity",
  style: "Style",
  citations: "Citations",
};

/**
 * Quotes are exact text from the document as it was reviewed (anchored on the server), or
 * null when Claude gave none or its quote could not be found.
 */
export interface ReviewPriority {
  title: string;
  detail: string;
  quote: string | null;
  category: ReviewCategory;
}

export interface ReviewSectionNote {
  /** 1-based, counting non-empty paragraphs and not headings, as the prompt numbers them. */
  paragraph: number | null;
  heading: string | null;
  note: string;
}

export interface ReviewResult {
  summary: string;
  thesis: { assessment: string; quote: string | null };
  strengths: string[];
  /** Most important first. */
  priorities: ReviewPriority[];
  sections: ReviewSectionNote[];
  structure: string;
  argument: string;
  evidence: string;
  style: string;
}

export interface DocumentReviewDTO {
  id: string;
  createdAt: string;
  model: string;
  wordCount: number;
  /** The document has changed since this review. */
  stale: boolean;
  result: ReviewResult;
}

export interface ReviewResponse {
  review: DocumentReviewDTO;
}

export type ReviewErrorCode = AiErrorCode | "refused" | "too_short" | "too_long" | "none";

export interface ReviewErrorBody {
  error: string;
  code?: ReviewErrorCode;
}

/**
 * Goals for paragraph suggestions: everything but the word target, which does not change what
 * Claude says about a paragraph, so setting it must not make every paragraph new again.
 */
export function paragraphGoals(goals: WritingGoals): WritingGoals {
  const rest = { ...goals };
  delete rest.targetWords;
  return rest;
}
