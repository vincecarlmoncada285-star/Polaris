// Plain text → HTML for htmlToDocument(). Paragraphs are separated by blank lines, and a single
// line break inside one is soft wrapping (a space). A file with no blank lines at all has one
// paragraph per line instead.
import { escapeHtml, htmlToDocument, type ImportedDocument } from "./html";

export function textToParagraphs(source: string): string[] {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const paragraphs = /\n[ \t]*\n/.test(text)
    ? text.split(/\n(?:[ \t]*\n)+/).map((p) =>
        p
          .split("\n")
          .map((l) => l.trim())
          .join(" "),
      )
    : text.split("\n");
  return paragraphs.map((p) => p.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
}

export function textToHtml(source: string): string {
  return textToParagraphs(source)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

export function textToDocument(source: string, fileName: string): ImportedDocument {
  return htmlToDocument(textToHtml(source), { fileName });
}
