// Footnotes: an inline atom node whose text lives in an attribute, so the writer's prose (and
// everything that reads it: rules, AI suggestions, word counts, the saved plain text) never
// contains it. The editor shows each marker as a superscript number in document order.
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { closeHistory, undo } from "@tiptap/pm/history";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { FOOTNOTE_NODE } from "./textblocks";

export const FOOTNOTE_MAX_CHARS = 2000;

/** A footnote's text as stored: plain, on one line, at most FOOTNOTE_MAX_CHARS characters. */
export function cleanFootnoteContent(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, FOOTNOTE_MAX_CHARS);
}

/** A random id for a new footnote (crypto.getRandomValues works without a secure context). */
export function newFootnoteId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `fn-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface FootnoteInfo {
  id: string;
  content: string;
  /** The marker's document position. */
  pos: number;
  /** 1-based, in document order. */
  number: number;
}

/** Every footnote in document order, numbered from 1. */
export function collectFootnotes(doc: PMNode): FootnoteInfo[] {
  const found: FootnoteInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === FOOTNOTE_NODE) {
      found.push({
        id: String(node.attrs.id ?? ""),
        content: String(node.attrs.content ?? ""),
        pos,
        number: found.length + 1,
      });
    }
    return !node.isLeaf;
  });
  return found;
}

/** The id used in DOM ids for a footnote: its own, or its number for one without an id. */
export const footnoteKey = (f: Pick<FootnoteInfo, "id" | "number">) => f.id || `n${f.number}`;
/** DOM ids of the marker in the text and of its entry (and the entry's text) under the article. */
export const footnoteRefId = (key: string) => `footnote-ref-${key}`;
export const footnoteEntryId = (key: string) => `footnote-${key}`;
export const footnoteTextId = (key: string) => `footnote-text-${key}`;

/** What the edit dialog works on. */
export interface FootnoteTarget {
  id: string;
  number: number;
  content: string;
  /**
   * For a footnote that was just inserted: the document right after the insertion. While the
   * document is still exactly that, saving folds the text into the insertion (one undo step
   * removes the whole footnote) and cancelling takes the insertion back.
   */
  inserted?: PMNode;
}

export interface FootnoteOptions {
  /** The writer wants to edit a footnote: just inserted, clicked, or selected and Enter. */
  onEdit: ((target: FootnoteTarget) => void) | null;
}

const numbersKey = new PluginKey<DecorationSet>("polaris-footnote-numbers");

/** Node decorations that carry each marker's number to its node view. */
function numberDecorations(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    collectFootnotes(doc).map((f) =>
      Decoration.node(f.pos, f.pos + 1, {}, { footnoteNumber: f.number }),
    ),
  );
}

function numberFrom(decorations: readonly Decoration[]): number | null {
  for (const d of decorations) {
    const n = (d.spec as { footnoteNumber?: unknown }).footnoteNumber;
    if (typeof n === "number") return n;
  }
  return null;
}

function targetFor(doc: PMNode, id: string, inserted?: PMNode): FootnoteTarget | null {
  const f = collectFootnotes(doc).find((x) => x.id === id);
  return f ? { id: f.id, number: f.number, content: f.content, inserted } : null;
}

export const Footnote = Node.create<FootnoteOptions>({
  name: FOOTNOTE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { onEdit: null };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id") || newFootnoteId(),
        renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
      },
      content: {
        default: "",
        parseHTML: (el) => cleanFootnoteContent(el.getAttribute("data-content")),
        renderHTML: (attrs) => ({ "data-content": cleanFootnoteContent(attrs.content) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes({ "data-footnote": "" }, HTMLAttributes)];
  },

  // Not part of the text: getText() (the saved plain text, word counts) leaves footnotes out.
  renderText() {
    return "";
  },

  addNodeView() {
    return ({ node, getPos, decorations }) => {
      const onEdit = () => this.options.onEdit;
      const dom = document.createElement("sup");
      dom.className = "polaris-footnote";
      dom.setAttribute("data-footnote", "");
      // A link to the entry under the article, announced with the footnote's text. Clicking it
      // edits the footnote instead of jumping; the entry links back.
      const link = document.createElement("a");
      link.tabIndex = -1;
      dom.append(link);
      let current = node;
      let number = numberFrom(decorations);
      const render = () => {
        const key = footnoteKey({ id: String(current.attrs.id ?? ""), number: number ?? 0 });
        dom.id = footnoteRefId(key);
        link.href = `#${footnoteEntryId(key)}`;
        link.textContent = number === null ? "*" : String(number);
        link.setAttribute("aria-label", number === null ? "Footnote" : `Footnote ${number}`);
        link.setAttribute("aria-describedby", footnoteTextId(key));
      };
      render();
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const pos = getPos();
        const handler = onEdit();
        if (typeof pos !== "number" || !handler) return;
        const target = targetFor(this.editor.state.doc, String(current.attrs.id ?? ""));
        if (target) handler(target);
      });
      return {
        dom,
        update: (updated, decos) => {
          if (updated.type !== current.type) return false;
          current = updated;
          number = numberFrom(decos);
          render();
          return true;
        },
        // The view sets its own attributes and text; none of that is an edit.
        ignoreMutation: () => true,
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-f": () => {
        const target = insertFootnote(this.editor);
        if (target) this.options.onEdit?.(target);
        return target !== null;
      },
      // A selected marker (arrowed onto, or clicked): Enter edits it rather than replacing it.
      Enter: () => {
        const { selection, doc } = this.editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== FOOTNOTE_NODE) {
          return false;
        }
        const target = targetFor(doc, String(selection.node.attrs.id ?? ""));
        if (target) this.options.onEdit?.(target);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: numbersKey,
        state: {
          init: (_config, state) => numberDecorations(state.doc),
          apply: (tr, prev) => (tr.docChanged ? numberDecorations(tr.doc) : prev),
        },
        props: { decorations: (state) => numbersKey.getState(state) },
        // A pasted copy of a footnote, or one without an id, gets an id of its own: the ids
        // name the marker and its entry in the page.
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          let tr = null;
          for (const f of collectFootnotes(state.doc)) {
            let id = f.id;
            if (!id || seen.has(id)) {
              id = newFootnoteId();
              const node = state.doc.nodeAt(f.pos)!;
              tr = (tr ?? state.tr).setNodeMarkup(f.pos, undefined, { ...node.attrs, id });
            }
            seen.add(id);
          }
          return tr;
        },
      }),
    ];
  },
});

/**
 * Inserts an empty footnote at the cursor (after the selection, which is kept as text) as its
 * own undo step, for the caller to open the edit dialog on. Null where a footnote cannot go
 * (a code block).
 */
export function insertFootnote(editor: Editor): FootnoteTarget | null {
  const { state } = editor;
  const type = state.schema.nodes[FOOTNOTE_NODE];
  if (!type) return null;
  const at = state.selection.to;
  const $at = state.doc.resolve(at);
  if (!$at.parent.inlineContent || !$at.parent.canReplaceWith($at.index(), $at.index(), type)) {
    return null;
  }
  const id = newFootnoteId();
  const tr = closeHistory(state.tr).insert(at, type.create({ id, content: "" }));
  tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
  editor.view.dispatch(tr);
  return targetFor(editor.state.doc, id, editor.state.doc);
}

/** Undoes the insertion of `target` if nothing has changed since. */
function takeBackInsertion(editor: Editor, target: FootnoteTarget): boolean {
  if (!target.inserted || editor.state.doc !== target.inserted) return false;
  return undo(editor.state, editor.view.dispatch);
}

/** Saves a footnote's text. Empty text is not saved (the dialog offers Delete for that). */
export function saveFootnote(editor: Editor, target: FootnoteTarget, raw: string): boolean {
  const content = cleanFootnoteContent(raw);
  if (!content) return false;
  const found = collectFootnotes(editor.state.doc).find((f) => f.id === target.id);
  if (!found) return false;
  const type = editor.state.schema.nodes[FOOTNOTE_NODE]!;
  if (takeBackInsertion(editor, target)) {
    // The document is as it was before the insertion: insert the finished footnote instead.
    const tr = editor.state.tr.insert(found.pos, type.create({ id: target.id, content }));
    tr.setSelection(TextSelection.create(tr.doc, found.pos + 1));
    editor.view.dispatch(tr);
    return true;
  }
  const node = editor.state.doc.nodeAt(found.pos)!;
  if (node.attrs.content === content) return true;
  const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, { ...node.attrs, content });
  tr.setSelection(TextSelection.create(tr.doc, found.pos + 1));
  editor.view.dispatch(tr);
  return true;
}

/** Deletes a footnote (undoably). A footnote just inserted is simply taken back. */
export function deleteFootnote(editor: Editor, target: FootnoteTarget): boolean {
  if (takeBackInsertion(editor, target)) return true;
  const found = collectFootnotes(editor.state.doc).find((f) => f.id === target.id);
  if (!found) return false;
  const tr = editor.state.tr.delete(found.pos, found.pos + 1);
  tr.setSelection(TextSelection.create(tr.doc, found.pos));
  editor.view.dispatch(tr);
  return true;
}

/** Closing the dialog without saving: a footnote just inserted (still empty) goes again. */
export function cancelFootnote(editor: Editor, target: FootnoteTarget): void {
  if (!target.inserted) return;
  const found = collectFootnotes(editor.state.doc).find((f) => f.id === target.id);
  if (found && !found.content) deleteFootnote(editor, target);
}

/** Puts the cursor right after a footnote's marker, for the writer to carry on from there. */
export function cursorAfterFootnote(editor: Editor, id: string): boolean {
  const found = collectFootnotes(editor.state.doc).find((f) => f.id === id);
  if (!found) return false;
  editor.commands.setTextSelection(found.pos + 1);
  // Focused now rather than on the next frame (TipTap's focus command waits for one), so a
  // click or a shortcut straight after the dialog closes is not undone by a late focus.
  editor.view.focus();
  return true;
}

/** Selects a footnote's marker in the text (from its entry under the article). */
export function selectFootnote(editor: Editor, id: string): boolean {
  const found = collectFootnotes(editor.state.doc).find((f) => f.id === id);
  if (!found) return false;
  editor.chain().setNodeSelection(found.pos).focus().scrollIntoView().run();
  return true;
}
