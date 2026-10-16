// The POST /api/ai/paragraph contract, shared by the route and the editor. Client-safe: no
// SDK, no server-only imports.
import { z } from "zod";
import { writingGoalsSchema } from "@/lib/documents/schema";
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
