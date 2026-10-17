import type { Node as PMNode } from "@tiptap/pm/model";

/** Stand-in for inline atoms (hard breaks, footnote markers) so text offsets stay aligned. */
export const OBJECT_REPLACEMENT = "￼";

/** The node name of a footnote marker (src/lib/editor/footnote.ts). */
export const FOOTNOTE_NODE = "footnote";

export interface TextBlock {
  /** Document position of the block's opening token. */
  pos: number;
  text: string;
  /**
   * Document position of text[offset]. Valid for 0 <= offset <= text.length. As the `end` of a
   * range, the position right after text[offset - 1]: the same unless a footnote marker was
   * omitted between them.
   */
  posAt(offset: number, edge?: "start" | "end"): number;
  /**
   * Offsets in `text` of footnote markers: each is a U+FFFC by default; with
   * `footnotes: "omit"` the marker takes no character and this is where it sits.
   */
  footnotes: number[];
}

export interface CollectOptions {
  /**
   * "marker" (default): a footnote is a U+FFFC like any inline atom, so offsets and positions
   * correspond one to one and nothing can be replaced across it unseen. "omit": footnotes take
   * no character, so the text reads as the writer's prose does (the Overview's measures, finding
   * a quoted passage); positions still map to the document, skipping the markers.
   */
  footnotes?: "marker" | "omit";
}

/** Collects every textblock (paragraph, heading, ...) with an offset → position map. */
export function collectTextBlocks(doc: PMNode, options: CollectOptions = {}): TextBlock[] {
  const omit = options.footnotes === "omit";
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const starts: number[] = []; // starts[i] = doc position of text[i]
    const footnotes: number[] = [];
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? "";
        for (let i = 0; i < t.length; i++) starts.push(childPos + i);
        text += t;
      } else if (child.type.name === FOOTNOTE_NODE) {
        footnotes.push(text.length);
        if (!omit) {
          starts.push(childPos);
          text += OBJECT_REPLACEMENT;
        }
      } else {
        starts.push(childPos);
        text += OBJECT_REPLACEMENT;
      }
    });
    const endPos = pos + node.nodeSize - 1;
    blocks.push({
      pos,
      text,
      posAt: (offset, edge = "start") => {
        // An end offset is the position right after the character before it. With markers
        // omitted that keeps a selection from taking in a footnote that follows the text.
        if (edge === "end" && offset > 0) {
          return offset - 1 < starts.length ? starts[offset - 1]! + 1 : endPos;
        }
        if (offset < starts.length) return starts[offset]!;
        return starts.length > 0 ? starts[starts.length - 1]! + 1 : endPos;
      },
      footnotes,
    });
    return false;
  });
  return blocks;
}

/**
 * A block's text with its footnote markers taken out (the text Claude is sent), and a map
 * from an offset in that text back to an offset in the block's own text. `toBlock(end)` for
 * an end offset lands right after the last character, before any marker that follows it.
 */
export function withoutFootnotes(block: Pick<TextBlock, "text" | "footnotes">): {
  text: string;
  toBlock(offset: number, edge?: "start" | "end"): number;
} {
  if (block.footnotes.length === 0) {
    return { text: block.text, toBlock: (offset) => offset };
  }
  const markers = new Set(block.footnotes);
  let text = "";
  const map: number[] = []; // map[i] = offset in block.text of text[i]
  for (let i = 0; i < block.text.length; i++) {
    if (markers.has(i)) continue;
    map.push(i);
    text += block.text[i];
  }
  return {
    text,
    toBlock: (offset, edge = "start") => {
      if (edge === "end") return offset <= 0 ? 0 : map[offset - 1]! + 1;
      return offset >= map.length ? block.text.length : map[offset]!;
    },
  };
}
