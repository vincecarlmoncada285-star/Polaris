// The document as a list of textblocks, read from its stored TipTap JSON. Client-safe.

/** One textblock: a paragraph (also inside lists and quotes), a heading or a code block. */
export interface DocBlock {
  text: string;
  /** Heading level (1-3), or null for anything that is not a heading. */
  heading: number | null;
}

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

interface JsonNode {
  type?: unknown;
  text?: unknown;
  attrs?: { level?: unknown } | null;
  content?: unknown;
}

const isNode = (v: unknown): v is JsonNode => typeof v === "object" && v !== null;

function inlineText(node: JsonNode): string {
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  return Array.isArray(node.content) ? node.content.filter(isNode).map(inlineText).join("") : "";
}

/** Every textblock in document order, or null when `content` is not a TipTap document. */
export function blocksFromContent(content: unknown): DocBlock[] | null {
  if (!isNode(content) || content.type !== "doc") return null;
  const blocks: DocBlock[] = [];
  const walk = (node: JsonNode) => {
    if (typeof node.type === "string" && TEXTBLOCKS.has(node.type)) {
      const level = Number(node.attrs?.level);
      blocks.push({
        text: inlineText(node),
        heading: node.type === "heading" ? (Number.isInteger(level) ? level : 1) : null,
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

/** The blocks' text joined by blank lines, as in the editor's plain text. */
export const blocksText = (blocks: readonly DocBlock[]) => blocks.map((b) => b.text).join("\n\n");

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
