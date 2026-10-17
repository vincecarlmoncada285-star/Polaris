// The one place imported content becomes a Polaris document. Every importer (Word, Markdown,
// plain text) produces HTML and ends here: it is parsed with DOMParser into a detached document
// (never inserted into the page, so nothing in it loads or runs), cleaned, and converted with
// the editor's own schema, so anything the editor cannot show is dropped.
import { generateText, getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { DOMParser as SchemaParser } from "@tiptap/pm/model";
import { documentExtensions } from "@/lib/editor/extensions";
import { cleanFootnoteContent } from "@/lib/editor/footnote";
import { isAllowedLinkHref } from "@/lib/editor/links";
import { noneDropped, type DroppedCounts } from "./notice";

export interface ImportedDocument {
  title: string;
  content: JSONContent;
  /** As the editor would save it: blocks separated by blank lines, footnotes left out. */
  plainText: string;
  dropped: DroppedCounts;
}

/** The longest title a document can have (src/lib/documents/schema.ts). */
export const TITLE_MAX = 200;

/** Removed with everything inside them, and counted: content the writer will miss. */
const IMAGES = ["img", "picture", "image"];
const EMBEDDED = [
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "video",
  "audio",
  "canvas",
  "svg",
  "math",
];
/** Removed with everything inside them: never content (or not content we can keep). */
const REMOVED = [
  "script",
  "style",
  "noscript",
  "template",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "link",
  "meta",
  "base",
  "head",
  "title",
  "dialog",
  "applet",
  "param",
  "source",
  "track",
];

/** Attributes kept, per element; every other attribute (on*, style, class, id...) goes. */
const KEPT_ATTRIBUTES: Record<string, string[]> = {
  a: ["href"],
  ol: ["start"],
  sup: ["data-footnote", "data-content"],
  code: ["class"],
};

const schema = () => getSchema(documentExtensions());

/** Removes every element matching `selector`, returning how many went. */
function removeAll(root: ParentNode, selector: string): number {
  const found = [...root.querySelectorAll(selector)];
  for (const el of found) el.remove();
  return found.length;
}

/** Replaces an element with its children. */
function unwrap(el: Element): void {
  el.replaceWith(...el.childNodes);
}

/**
 * Cleans a parsed document in place and counts what it removed: images, tables and embedded
 * content (counted, for the writer), scripts, styles and form controls (not content), every
 * attribute except the few the schema reads (so no on* handler or style survives), and links
 * whose target is not http, https or mailto (their text stays).
 */
export function sanitizeImportedDom(doc: Document): DroppedCounts {
  const dropped = noneDropped();
  const body = doc.body;
  removeAll(doc, REMOVED.join(","));
  // Images inside tables are counted too: the table goes with them.
  dropped.images = removeAll(body, IMAGES.join(","));
  dropped.embedded = removeAll(body, EMBEDDED.join(","));
  // Only the outermost tables are counted; nested ones go with them.
  const tables = [...body.querySelectorAll("table")].filter(
    (t) => !t.parentElement?.closest("table"),
  );
  for (const t of tables) t.remove();
  dropped.tables = tables.length;

  for (const el of [...body.querySelectorAll("*")]) {
    const tag = el.tagName.toLowerCase();
    const kept = KEPT_ATTRIBUTES[tag] ?? [];
    for (const attr of [...el.attributes]) {
      if (!kept.includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (tag === "a" && !isAllowedLinkHref(el.getAttribute("href"))) {
      unwrap(el);
    } else if (tag === "sup" && el.hasAttribute("data-footnote")) {
      // A footnote marker: no content of its own, and plain, bounded text.
      el.setAttribute("data-content", cleanFootnoteContent(el.getAttribute("data-content")));
      el.replaceChildren();
    } else if (tag === "sup") {
      el.removeAttribute("data-content");
    } else if (tag === "code" && !/^language-[\w+-]{1,40}$/.test(el.getAttribute("class") ?? "")) {
      el.removeAttribute("class");
    } else if (/^h[4-6]$/.test(tag)) {
      // The editor has three heading levels.
      const h3 = doc.createElement("h3");
      h3.append(...el.childNodes);
      el.replaceWith(h3);
    }
  }
  // Markdown ends a code block's text with a line break, which would show as an empty line.
  for (const pre of [...body.querySelectorAll("pre")]) {
    const walker = doc.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) last = walker.currentNode as Text;
    if (last?.data.endsWith("\n")) last.data = last.data.slice(0, -1);
  }
  // An empty list (mammoth ends every document with one for its notes) would become an empty
  // bullet.
  for (const list of [...body.querySelectorAll("ul, ol")]) {
    if (!list.querySelector("li")) list.remove();
  }
  return dropped;
}

const fileStem = (fileName: string) =>
  fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .trim() || "Imported document";

const clip = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX).trim();

export interface ConvertOptions {
  /** Used for the title when the content has none. */
  fileName: string;
  /**
   * Runs on the parsed document before it is cleaned (to turn Word's footnotes into ours, say),
   * and may return the title the source gave (Word's Title style).
   */
  prepare?: (doc: Document) => string | null;
  /** Counts the source knew of and the HTML no longer shows (Word comments, tracked changes). */
  dropped?: Partial<DroppedCounts>;
}

/**
 * Imported HTML as a Polaris document. Title: what `prepare` found, else the first level-1
 * heading (taken out of the body), else the file name without its extension.
 */
export function htmlToDocument(html: string, options: ConvertOptions): ImportedDocument {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let title = clip(options.prepare?.(doc) ?? "");
  const dropped = sanitizeImportedDom(doc);
  for (const [k, v] of Object.entries(options.dropped ?? {})) {
    dropped[k as keyof DroppedCounts] += v ?? 0;
  }
  if (!title) {
    const h1 = doc.body.querySelector("h1");
    if (h1) {
      title = clip(h1.textContent ?? "");
      h1.remove();
    }
  }
  if (!title) title = clip(fileStem(options.fileName));

  const extensions = documentExtensions();
  const parsed = SchemaParser.fromSchema(schema()).parse(doc.body);
  const content = parsed.toJSON() as JSONContent;
  const plainText = generateText(content, extensions, { blockSeparator: "\n\n" });
  return { title, content, plainText, dropped };
}

/** Text for HTML: what a reader should see, never markup. */
export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
