// Word (.docx) → HTML for htmlToDocument(), with mammoth (its browser build: the package's
// "browser" field swaps in the parts that read files). Loaded only when a .docx is imported.
import JSZip from "jszip";
import mammoth from "mammoth";
import { htmlToDocument, type ImportedDocument } from "./html";

/** Thrown for a file that is not a Word document we can read. */
export class DocxReadError extends Error {}

const NOTE_PREFIX = "polaris-note-";
const TITLE_CLASS = "polaris-docx-title";
/** What mammoth writes a note's paragraphs (and any list or table in it) as. */
const NOTE_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th";

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
 * text. Returns the first Title-style paragraph, for htmlToDocument() to take out as the title.
 */
export function prepareDocxHtml(doc: Document): Element | null {
  const notes = new Map<string, string>();
  for (const li of [...doc.querySelectorAll(`li[id^="${NOTE_PREFIX}"]`)]) {
    const copy = li.cloneNode(true) as Element;
    // The "↑" link back to the reference.
    for (const back of copy.querySelectorAll(`a[href^="#${NOTE_PREFIX}"]`)) back.remove();
    // A note is kept as one line: its line breaks and paragraphs become spaces, so the last
    // word of one paragraph does not run into the first of the next.
    for (const br of copy.querySelectorAll("br")) br.replaceWith(" ");
    for (const block of copy.querySelectorAll(NOTE_BLOCKS)) block.append(" ");
    // Whole: the clean-up cuts a note that is too long, and counts it for the notice.
    notes.set(li.id, (copy.textContent ?? "").replace(/\s+/g, " ").trim());
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
  return doc.querySelector(`h1.${TITLE_CLASS}`);
}

/**
 * What mammoth leaves out without saying: Word comments, deleted text from tracked changes, and
 * equations (Office Math, which it skips along with the text in them).
 */
async function countLeftOut(
  zip: JSZip,
): Promise<{ comments: number; trackedChanges: number; equations: number }> {
  const [comments, body] = await Promise.all([
    zip.file("word/comments.xml")?.async("string") ?? Promise.resolve(""),
    zip.file("word/document.xml")!.async("string"),
  ]);
  return {
    comments: comments.match(/<w:comment\b/g)?.length ?? 0,
    trackedChanges: body.match(/<w:(?:del|moveFrom)\b/g)?.length ?? 0,
    // Each equation is an <m:oMath>; a displayed one also sits in an <m:oMathPara>.
    equations: body.match(/<m:oMath\b/g)?.length ?? 0,
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
