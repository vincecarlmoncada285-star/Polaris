// Student text goes into prompts between our own tags, as data. These helpers make sure it
// cannot close those tags early or pose as our own markup.
import { OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";

// Whitespace and invisible format characters (zero-width spaces and joiners, soft hyphens)
// between "<", "/" and the name do not stop a reader from seeing a tag.
const GAP = "[\\s\\p{Cf}]*";

/** The character that replaces "<": full-width, so it reads the same but is never a tag. */
export const NEUTRAL_LT = "＜";

/**
 * A function that makes student text safe to place between the given tags: the "<" of
 * anything that looks like one of them (opening or closing, any case or spacing) becomes "＜",
 * so "</paragraph>" in an essay cannot end the data block early. One character for one keeps
 * offsets aligned, and the anchoring treats "＜" as "<". Inline atoms go over as line breaks,
 * and are turned into them first, so "<" + hard break + "/paragraph>" is caught as the spaced
 * tag it becomes. Each prompt passes the tags it uses.
 */
export function createNeutralizer(tags: readonly string[]): (text: string) => string {
  const tagLike = new RegExp(`<(?=${GAP}/?${GAP}(?:${tags.join("|")})\\b)`, "giu");
  return (text) => text.replaceAll(OBJECT_REPLACEMENT, "\n").replace(tagLike, NEUTRAL_LT);
}

/** The tags of the paragraph prompt (src/lib/ai/paragraph.ts). */
export const PARAGRAPH_DATA_TAGS = [
  "paragraph",
  "previous_paragraph",
  "document_title",
  "writing_goals",
] as const;

/** The tags of the review prompt (src/lib/ai/review.ts). */
export const REVIEW_DATA_TAGS = ["document", "document_title", "outline", "writing_goals"] as const;

/** Paragraph and footnote markers in the review prompt: "[P12]", "[^3]". */
const MARKER_LIKE = /\[(?=[\s\p{Cf}]*(?:P|\^)[\s\p{Cf}]*\d+[\s\p{Cf}]*\])/giu;

/** The character that replaces the "[" of a marker-like "[P3]": full-width, like NEUTRAL_LT. */
export const NEUTRAL_LBRACKET = "［";

/**
 * Student text that itself contains "[P3]" or "[^3]" would read as one of the review prompt's
 * paragraph or footnote markers; its "[" becomes "［" (again one character for one, and the
 * anchoring treats "［" as "[", so a quote copied from the prompt is still found in the text).
 */
export function neutralizeMarkers(text: string): string {
  return text.replace(MARKER_LIKE, NEUTRAL_LBRACKET);
}
