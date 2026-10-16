// The structured-output schema Claude fills in, and the clean-up applied to what comes back.
// Built with zod/v4 because the SDK's betaZodOutputFormat helper needs it; app schemas stay on
// plain "zod". Kept to objects, strings, enums, arrays and nullables: the helper strips
// constraints such as maxLength, so lengths and counts are enforced here after parsing.
import { z } from "zod/v4";
import type { Category } from "@/lib/rules/types";

const CATEGORY_IDS = [
  "correctness",
  "clarity",
  "concision",
  "formality",
  "citations",
] as const satisfies readonly Category[];

export const ParagraphFeedbackSchema = z.object({
  suggestions: z.array(
    z.object({
      quote: z
        .string()
        .describe(
          "Exact text copied from the paragraph: as short as possible while unique in the paragraph.",
        ),
      occurrence: z
        .number()
        .nullable()
        .describe("1-based occurrence of the quote when it appears more than once; else null."),
      category: z.enum(CATEGORY_IDS),
      message: z.string().describe("Headline, at most 80 characters."),
      explanation: z
        .string()
        .describe("One or two sentences to the student saying why, at most 300 characters."),
      replacement: z
        .string()
        .nullable()
        .describe("Text to put in place of the quote, or null if the student should rephrase."),
    }),
  ),
});

export type ParagraphFeedback = z.infer<typeof ParagraphFeedbackSchema>;

export const MAX_AI_SUGGESTIONS = 6;
export const MAX_MESSAGE_CHARS = 80;
export const MAX_EXPLANATION_CHARS = 300;
/** A longer "replacement" is a rewrite, not a minimal edit: shown as "rephrase" instead. */
export const MAX_REPLACEMENT_CHARS = 600;

/** A suggestion after clean-up, not yet anchored to offsets in the paragraph. */
export interface SuggestionDraft {
  quote: string;
  /** 1-based, or null for "the first (or only) one". */
  occurrence: number | null;
  category: Category;
  message: string;
  explanation: string;
  /** "" deletes the quote; null means the student should rephrase. */
  replacement: string | null;
}

/** Cuts `s` to at most `max` characters, at a word boundary when one is close, with "…". */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space >= max - 20) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/**
 * Trims and truncates every field, drops suggestions with an empty quote, message or
 * explanation, and keeps the first MAX_AI_SUGGESTIONS (Claude is asked to put the most
 * important first).
 */
export function cleanFeedback(feedback: ParagraphFeedback): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  for (const s of feedback.suggestions) {
    const quote = s.quote.trim();
    const message = truncate(s.message.trim(), MAX_MESSAGE_CHARS);
    const explanation = truncate(s.explanation.trim(), MAX_EXPLANATION_CHARS);
    if (!quote || !message || !explanation) continue;
    let replacement = s.replacement === null ? null : s.replacement.trim();
    if (replacement !== null && replacement.length > MAX_REPLACEMENT_CHARS) replacement = null;
    const occurrence =
      s.occurrence !== null && Number.isInteger(s.occurrence) && s.occurrence >= 1
        ? s.occurrence
        : null;
    out.push({ quote, occurrence, category: s.category, message, explanation, replacement });
    if (out.length === MAX_AI_SUGGESTIONS) break;
  }
  return out;
}
