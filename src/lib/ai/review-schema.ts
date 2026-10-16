// The structured-output schema for a whole-document review, and the clean-up applied to what
// comes back. Built with zod/v4 for the SDK helper, and kept to simple types: the helper drops
// constraints such as maxLength or maxItems, so lengths and counts are enforced here.
import { z } from "zod/v4";
import { findQuote } from "./anchor";
import { REVIEW_CATEGORIES, type ReviewResult } from "./protocol";
import { truncate } from "./schema";

const quote = (what: string) =>
  z
    .string()
    .nullable()
    .describe(
      `${what}, copied character for character from the document: a phrase or one sentence. Null if there is none.`,
    );

export const DocumentReviewSchema = z.object({
  summary: z
    .string()
    .describe("Two or three sentences on what the document argues or reports, as you read it."),
  thesis: z.object({
    assessment: z
      .string()
      .describe("Two to four sentences on the thesis or research question and how well it works."),
    quote: quote("The sentence that states the thesis"),
  }),
  strengths: z
    .array(z.string())
    .describe("Up to 4 things this document does well, one sentence each."),
  priorities: z
    .array(
      z.object({
        title: z.string().describe("A short headline, at most 80 characters."),
        detail: z
          .string()
          .describe("Two to four sentences: the problem, why it matters, what to do."),
        quote: quote("A short passage that locates the problem"),
        category: z.enum(REVIEW_CATEGORIES),
      }),
    )
    .describe("Up to 5 revisions that would help most, most important first."),
  sections: z
    .array(
      z.object({
        paragraph: z.number().nullable().describe("The [P] number the note is about, or null."),
        heading: z.string().nullable().describe("The heading of the section, or null."),
        note: z.string().describe("One or two sentences."),
      }),
    )
    .describe("Up to 8 notes on particular paragraphs or sections, in document order."),
  structure: z.string().describe("Two to four sentences on the structure and flow."),
  argument: z.string().describe("Two to four sentences on the argument and its logic."),
  evidence: z.string().describe("Two to four sentences on the evidence and how it is used."),
  style: z.string().describe("Two to four sentences on style, register and clarity overall."),
});

export type RawDocumentReview = z.infer<typeof DocumentReviewSchema>;

export const REVIEW_LIMITS = {
  strengths: 4,
  priorities: 5,
  sections: 8,
  summaryChars: 700,
  assessmentChars: 700,
  strengthChars: 300,
  titleChars: 80,
  detailChars: 900,
  noteChars: 500,
  headingChars: 200,
  aspectChars: 1500,
  /** A longer "quote" is a passage, not a pointer to one: dropped. */
  quoteChars: 400,
} as const;

const OUTER_QUOTES = /^["'“”‘’«»]+|["'“”‘’«»]+$/g;
const LEADING_MARKER = /^\s*\[P\d+\]\s*/i;

/**
 * The quote as it stands in `text` (exact characters), or null. Tolerates what the anchoring
 * tolerates (curly vs straight quotes, dashes, whitespace), plus wrapping quotation marks and
 * a paragraph marker copied from the prompt.
 */
export function anchorQuote(text: string, raw: string | null): string | null {
  if (raw === null) return null;
  const candidates = [raw.trim(), raw.trim().replace(LEADING_MARKER, "").replace(OUTER_QUOTES, "")];
  for (const q of candidates) {
    if (!q || q.length > REVIEW_LIMITS.quoteChars) continue;
    const range = findQuote(text, q);
    if (range) return text.slice(range[0], range[1]);
  }
  return null;
}

const clean = (s: string | null, max: number) => truncate((s ?? "").trim(), max);

/**
 * Trims and truncates every field, drops empty items, keeps at most the allowed number of
 * each (Claude lists the most important first), keeps only paragraph numbers that exist, and
 * anchors every quote against the reviewed text: a quote that is not found is dropped, the
 * item it belongs to is kept. Null when there is not even a summary.
 */
export function cleanReview(
  raw: RawDocumentReview,
  { text, paragraphs }: { text: string; paragraphs: number },
): ReviewResult | null {
  const L = REVIEW_LIMITS;
  const summary = clean(raw.summary, L.summaryChars);
  if (!summary) return null;
  return {
    summary,
    thesis: {
      assessment: clean(raw.thesis.assessment, L.assessmentChars),
      quote: anchorQuote(text, raw.thesis.quote),
    },
    strengths: raw.strengths
      .map((s) => clean(s, L.strengthChars))
      .filter(Boolean)
      .slice(0, L.strengths),
    priorities: raw.priorities
      .map((p) => ({
        title: clean(p.title, L.titleChars),
        detail: clean(p.detail, L.detailChars),
        quote: anchorQuote(text, p.quote),
        category: p.category,
      }))
      .filter((p) => p.title && p.detail)
      .slice(0, L.priorities),
    sections: raw.sections
      .map((s) => ({
        paragraph:
          s.paragraph !== null &&
          Number.isInteger(s.paragraph) &&
          s.paragraph >= 1 &&
          s.paragraph <= paragraphs
            ? s.paragraph
            : null,
        heading: clean(s.heading, L.headingChars) || null,
        note: clean(s.note, L.noteChars),
      }))
      .filter((s) => s.note)
      .slice(0, L.sections),
    structure: clean(raw.structure, L.aspectChars),
    argument: clean(raw.argument, L.aspectChars),
    evidence: clean(raw.evidence, L.aspectChars),
    style: clean(raw.style, L.aspectChars),
  };
}
