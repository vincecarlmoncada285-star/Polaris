import type { Node as PMNode } from "@tiptap/pm/model";

/** Stand-in for inline atoms (hard breaks, images) so text offsets stay aligned. */
export const OBJECT_REPLACEMENT = "￼";

export interface TextBlock {
  /** Document position of the block's opening token. */
  pos: number;
  text: string;
  /** Document position of text[offset]. Valid for 0 <= offset <= text.length. */
  posAt(offset: number): number;
}

/** Collects every textblock (paragraph, heading, ...) with an offset → position map. */
export function collectTextBlocks(doc: PMNode): TextBlock[] {
  const blocks: TextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const starts: number[] = []; // starts[i] = doc position of text[i]
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? "";
        for (let i = 0; i < t.length; i++) starts.push(childPos + i);
        text += t;
      } else {
        starts.push(childPos);
        text += OBJECT_REPLACEMENT;
      }
    });
    const endPos = pos + node.nodeSize - 1;
    blocks.push({
      pos,
      text,
      posAt: (offset) => (offset >= starts.length ? endPos : starts[offset]!),
    });
    return false;
  });
  return blocks;
}
