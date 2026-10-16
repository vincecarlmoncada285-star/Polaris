import { z } from "zod";

export const TARGET_WORDS_MIN = 50;
export const TARGET_WORDS_MAX = 200_000;

export const writingGoalsSchema = z
  .object({
    audience: z.enum(["expert", "knowledgeable", "general"]).optional(),
    formality: z.enum(["formal", "neutral"]).optional(),
    citationStyle: z.enum(["apa", "mla", "chicago", "ieee"]).optional(),
    documentType: z
      .enum(["essay", "research-paper", "thesis", "lab-report", "literature-review"])
      .optional(),
    /** The length the writer is aiming for, in words. Shown as progress in the Overview. */
    targetWords: z.number().int().min(TARGET_WORDS_MIN).max(TARGET_WORDS_MAX).optional(),
  })
  .strict();

export type WritingGoals = z.infer<typeof writingGoalsSchema>;

const MAX_CONTENT_BYTES = 5_000_000;

export const createDocumentSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().max(200),
    content: z.unknown().refine((v) => JSON.stringify(v ?? null).length <= MAX_CONTENT_BYTES, {
      message: "Document is too large",
    }),
    plainText: z.string().max(MAX_CONTENT_BYTES),
    goals: writingGoalsSchema,
  })
  .partial();

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
