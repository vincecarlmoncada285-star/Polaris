// The document as a list of textblocks, read from its stored TipTap JSON. Client-safe.

/** A footnote in a block: where its marker sits in the block's text, and what it says. */
export interface BlockFootnote {
  /** Offset in the block's text (which leaves footnotes out) of the marker. */
  offset: number;
  content: string;
}

/** One textblock: a paragraph (also inside lists and quotes), a heading or a code block. */
export interface DocBlock {
  /** The text as the writer's prose: footnotes are not part of it (nor of the plain text). */
  text: string;
  /** Heading level (1-3), or null for anything that is not a heading. */
  heading: number | null;
  /** The block's footnotes, in order; absent when it has none. */
  footnotes?: BlockFootnote[];
}

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

interface JsonNode {
  type?: unknown;
  text?: unknown;
  attrs?: { level?: unknown; content?: unknown } | null;
  content?: unknown;
}

const isNode = (v: unknown): v is JsonNode => typeof v === "object" && v !== null;

/** A textblock's text, and its footnotes with the offsets where their markers sit. */
function inlineContent(node: JsonNode): { text: string; footnotes: BlockFootnote[] } {
  let text = "";
  const footnotes: BlockFootnote[] = [];
  const walk = (n: JsonNode) => {
    if (n.type === "text") text += typeof n.text === "string" ? n.text : "";
    else if (n.type === "hardBreak") text += "\n";
    else if (n.type === "footnote") {
      const content = n.attrs?.content;
      footnotes.push({ offset: text.length, content: typeof content === "string" ? content : "" });
    } else if (Array.isArray(n.content)) n.content.filter(isNode).forEach(walk);
  };
  if (Array.isArray(node.content)) node.content.filter(isNode).forEach(walk);
  return { text, footnotes };
}

/** Every textblock in document order, or null when `content` is not a TipTap document. */
export function blocksFromContent(content: unknown): DocBlock[] | null {
  if (!isNode(content) || content.type !== "doc") return null;
  const blocks: DocBlock[] = [];
  const walk = (node: JsonNode) => {
    if (typeof node.type === "string" && TEXTBLOCKS.has(node.type)) {
      const level = Number(node.attrs?.level);
      const { text, footnotes } = inlineContent(node);
      blocks.push({
        text,
        heading: node.type === "heading" ? (Number.isInteger(level) ? level : 1) : null,
        ...(footnotes.length ? { footnotes } : {}),
      });
      return;
    }
    if (Array.isArray(node.content)) node.content.filter(isNode).forEach(walk);
  };
  walk(content);
  return blocks;
}

/** The blocks of plain text (blank-line separated), for a document without usable JSON. */
export function blocksFromPlainText(plainText: string): DocBlock[] {
  return plainText.split(/\n[ \t]*\n/).map((text) => ({ text, heading: null }));
}

/**
 * The document as a review reads it: the textblocks of its stored JSON, or of its plain text
 * when it has no JSON. The JSON is what the editor shows (and what the prompt is built from),
 * so the length limits, the word count and the staleness check all use these blocks too.
 */
export function reviewBlocks(doc: { content: unknown; plainText: string }): DocBlock[] {
  return blocksFromContent(doc.content) ?? blocksFromPlainText(doc.plainText);
}

/** The blocks' text joined by blank lines, as in the editor's plain text (no footnotes). */
export const blocksText = (blocks: readonly DocBlock[]) => blocks.map((b) => b.text).join("\n\n");

/** Every footnote's text, in document order (numbered from 1 in a review and in the editor). */
export const blocksFootnotes = (blocks: readonly DocBlock[]): string[] =>
  blocks.flatMap((b) => (b.footnotes ?? []).map((f) => f.content));

/**
 * Where each footnote is and what it says, as one string: with the plain text and the layout,
 * everything a review depends on. The editor compares it to tell that a review is stale after a
 * footnote edit, and the server's contentHash() covers the same.
 */
export const footnotesLayout = (blocks: readonly DocBlock[]): string =>
  JSON.stringify(
    blocks.flatMap((b, i) => (b.footnotes ?? []).map((f) => [i, f.offset, f.content])),
  );

/**
 * Each block's heading level, or 0, e.g. "2,0,0": the layout blockLayout() in
 * src/lib/editor/locate.ts reads from the editor, here from stored blocks, so the editor can
 * start with the right one before it has loaded the document.
 */
export const blocksLayout = (blocks: readonly DocBlock[]) =>
  blocks.map((b) => b.heading ?? 0).join(",");

/**
 * Whether a block gets a paragraph number in a review: it is not a heading and has text.
 * The editor numbers paragraphs the same way when the writer jumps to one; its blocks carry
 * U+FFFC for inline atoms, which do not count as text here either.
 */
export const isNumberedParagraph = (block: { text: string; heading: number | null }) =>
  block.heading === null && block.text.replaceAll("\uFFFC", "").trim() !== "";
