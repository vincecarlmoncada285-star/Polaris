// Reading the editor's TipTap JSON for the exporters. Pure: no editor, no DOM.
import type { JSONContent } from "@tiptap/core";
import { cleanFootnoteContent } from "@/lib/editor/footnote";
import { exportableHref } from "@/lib/editor/links";

export type DocNode = JSONContent;

export const childrenOf = (node: DocNode | undefined): DocNode[] =>
  Array.isArray(node?.content) ? node.content.filter((c) => c && typeof c === "object") : [];

export const hasMark = (node: DocNode, type: string) =>
  !!node.marks?.some((m) => m && m.type === type);

/** The text node's link, if it has one Polaris would export (http, https or mailto). */
export function linkOf(node: DocNode): string | null {
  const mark = node.marks?.find((m) => m && m.type === "link");
  return mark ? exportableHref(mark.attrs?.href) : null;
}

export const footnoteContent = (node: DocNode) => cleanFootnoteContent(node.attrs?.content);

export const headingLevel = (node: DocNode) =>
  Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));

/** An ordered list's first number (TipTap's `start` attribute), 1 when unset. */
export const listStart = (node: DocNode) => {
  const start = Number(node.attrs?.start);
  return Number.isInteger(start) && start >= 0 ? start : 1;
};

/** Numbers footnotes in document order as an exporter meets them, and keeps their text. */
export class FootnoteCounter {
  readonly notes: string[] = [];
  add(node: DocNode): number {
    this.notes.push(footnoteContent(node));
    return this.notes.length;
  }
}
