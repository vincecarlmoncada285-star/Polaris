// Finding things in the editor's document: a sentence the Overview measured, a passage a
// review quoted, a paragraph a review numbered. Each returns document positions to select.
import type { Node as PMNode } from "@tiptap/pm/model";
import { findQuote } from "@/lib/ai/anchor";
import { isNumberedParagraph } from "@/lib/documents/blocks";
import type { MetricsBlock, SentenceLocation } from "@/lib/text/metrics";
import { collectTextBlocks, type TextBlock } from "./textblocks";

export interface DocRange {
  from: number;
  to: number;
}

const isHeading = (doc: PMNode, block: TextBlock) => doc.nodeAt(block.pos)?.type.name === "heading";

/**
 * The writer's prose: footnote markers take no character (their text is not part of it), so the
 * Overview measures, and quotes are found in, the same text as the saved plain text has.
 */
const proseBlocks = (doc: PMNode) => collectTextBlocks(doc, { footnotes: "omit" });

/** The document's textblocks for computeMetrics(), headings marked, footnotes left out. */
export function metricsBlocks(doc: PMNode): MetricsBlock[] {
  return proseBlocks(doc).map((b) => ({ text: b.text, heading: isHeading(doc, b) }));
}

/**
 * Each textblock's heading level, or 0 for anything else, e.g. "2,0,0". Together with the plain
 * text it is everything the Overview's metrics and a review's paragraph numbers depend on:
 * making a paragraph a heading changes this and leaves the text as it was. Cheap enough to
 * take on every change: it does not look inside the blocks.
 */
export function blockLayout(doc: PMNode): string {
  const levels: number[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    levels.push(node.type.name === "heading" ? Number(node.attrs.level) || 1 : 0);
    return false;
  });
  return levels.join(",");
}

/** Blocks are joined with this, as in the document's plain text. */
const SEPARATOR = "\n\n";

/**
 * Where `quote` is in the document now, or null. Matched against the whole text (blocks joined
 * by blank lines, as the plain text that was reviewed), tolerating the typographic variants the
 * anchoring tolerates, so a quote may run across a paragraph break.
 */
export function findTextInDoc(doc: PMNode, quote: string): DocRange | null {
  const blocks = proseBlocks(doc);
  const starts: number[] = [];
  let text = "";
  blocks.forEach((b, i) => {
    if (i > 0) text += SEPARATOR;
    starts.push(text.length);
    text += b.text;
  });
  const range = findQuote(text, quote);
  if (!range) return null;
  // The block an offset falls in (or, in a separator, the block before it), and the position.
  const position = (offset: number, edge: "start" | "end") => {
    let i = starts.length - 1;
    while (i > 0 && starts[i]! > offset - (edge === "end" ? 1 : 0)) i--;
    const block = blocks[i]!;
    const local = Math.min(Math.max(offset - starts[i]!, 0), block.text.length);
    return block.posAt(local, edge);
  };
  const from = position(range[0], "start");
  const to = position(range[1], "end");
  return to > from ? { from, to } : null;
}

/**
 * The sentence the Overview measured, if it is still where it was; otherwise wherever its text
 * now is; null if it is gone. Metrics are computed a moment after typing stops, so the document
 * may have moved on.
 */
export function findSentence(doc: PMNode, sentence: SentenceLocation): DocRange | null {
  const block = proseBlocks(doc)[sentence.block];
  if (block && block.text.slice(sentence.start, sentence.end) === sentence.text) {
    return { from: block.posAt(sentence.start), to: block.posAt(sentence.end, "end") };
  }
  return findTextInDoc(doc, sentence.text);
}

/** The n-th paragraph (1-based), numbered as the review prompt numbers them, or null. */
export function findParagraph(doc: PMNode, n: number): DocRange | null {
  let count = 0;
  for (const block of proseBlocks(doc)) {
    if (!isNumberedParagraph({ text: block.text, heading: isHeading(doc, block) ? 1 : null })) {
      continue;
    }
    if (++count === n) {
      return { from: block.posAt(0), to: block.posAt(block.text.length, "end") };
    }
  }
  return null;
}
