// Word (.docx) → HTML for htmlToDocument(), with mammoth (its browser build: the package's
// "browser" field swaps in the parts that read files). Loaded only when a .docx is imported.
import JSZip from "jszip";
import mammoth from "mammoth";
import { cleanFootnoteContent } from "@/lib/editor/footnote";
import { htmlToDocument, type ImportedDocument } from "./html";

/** Thrown for a file that is not a Word document we can read. */
export class DocxReadError extends Error {}

const NOTE_PREFIX = "polaris-note-";
const TITLE_CLASS = "polaris-docx-title";

/**
 * Word styles → HTML. Title is marked so it can become the document's title; Quote becomes a
 * block quote; underline is kept (mammoth drops it by default). Mammoth's defaults still apply
 * after these: headings 1-6, lists, bold, italic, strikethrough, links, footnotes and endnotes.
 */
export const DOCX_STYLE_MAP = [
  `p[style-name='Title'] => h1.${TITLE_CLASS}:fresh`,
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "u => u",
];

/**
 * Mammoth's footnote and endnote references (<sup><a href="#…footnote-1">[1]</a></sup>) and the
 * list of notes it puts at the end become Polaris footnote markers, each holding its note's
 * text. Returns the text of the first Title-style paragraph, which it takes out of the body.
 */
export function prepareDocxHtml(doc: Document): string | null {
  const notes = new Map<string, string>();
  for (const li of [...doc.querySelectorAll(`li[id^="${NOTE_PREFIX}"]`)]) {
    const copy = li.cloneNode(true) as Element;
    // The "↑" link back to the reference.
    for (const back of copy.querySelectorAll(`a[href^="#${NOTE_PREFIX}"]`)) back.remove();
    notes.set(li.id, cleanFootnoteContent(copy.textContent ?? ""));
    const list = li.parentElement;
    li.remove();
    if (list && !list.querySelector("li")) list.remove();
  }
  for (const ref of [...doc.querySelectorAll(`sup > a[href^="#${NOTE_PREFIX}"]`)]) {
    const sup = ref.parentElement!;
    const marker = doc.createElement("sup");
    marker.setAttribute("data-footnote", "");
    marker.setAttribute("data-content", notes.get(ref.getAttribute("href")!.slice(1)) ?? "");
    sup.replaceWith(marker);
  }
  const title = doc.querySelector(`h1.${TITLE_CLASS}`);
  if (!title) return null;
  const text = title.textContent?.trim() ?? "";
  title.remove();
  return text || null;
}

/** What mammoth leaves out without saying: Word comments, and deleted text from tracked changes. */
async function countLeftOut(zip: JSZip): Promise<{ comments: number; trackedChanges: number }> {
  const [comments, body] = await Promise.all([
    zip.file("word/comments.xml")?.async("string") ?? Promise.resolve(""),
    zip.file("word/document.xml")!.async("string"),
  ]);
  return {
    comments: comments.match(/<w:comment\b/g)?.length ?? 0,
    trackedChanges: body.match(/<w:(?:del|moveFrom)\b/g)?.length ?? 0,
  };
}

export async function docxToDocument(
  data: ArrayBuffer,
  fileName: string,
): Promise<ImportedDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new DocxReadError("not a zip");
  }
  if (!zip.file("word/document.xml")) throw new DocxReadError("no word/document.xml");
  const leftOut = await countLeftOut(zip);

  // The browser build reads `arrayBuffer`; Node (the tests) reads `buffer`.
  const input = { arrayBuffer: data, buffer: data } as unknown as { arrayBuffer: ArrayBuffer };
  let html: string;
  try {
    const result = await mammoth.convertToHtml(input, {
      styleMap: DOCX_STYLE_MAP,
      idPrefix: NOTE_PREFIX,
      // Images are left out, so they are not encoded only to be thrown away; an empty <img>
      // stays as a placeholder for the count.
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    });
    html = result.value;
  } catch {
    throw new DocxReadError("mammoth failed");
  }
  return htmlToDocument(html, { fileName, prepare: prepareDocxHtml, dropped: leftOut });
}
