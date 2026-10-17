// Importing a file, in the browser: read it, convert it with the right (lazily loaded)
// converter, and hand back the document. The file itself is never uploaded; only the document
// it becomes is saved, through the documents API.
import type { ImportedDocument } from "./html";

export type { ImportedDocument } from "./html";

/** Files larger than this are refused before they are read. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** For the file picker. */
export const IMPORT_ACCEPT =
  ".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain";

export type ImportKind = "docx" | "markdown" | "text";

export function importKind(fileName: string): ImportKind | null {
  const ext = /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1];
  if (ext === "docx") return "docx";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt") return "text";
  return null;
}

/** A failed import, with a message for the writer. Nothing has been created. */
export class ImportError extends Error {}

export const IMPORT_ERRORS = {
  unsupported: (name: string) =>
    /\.doc$/i.test(name)
      ? "Polaris can’t read older Word (.doc) files. Open it in Word and save it as .docx, then import that."
      : "Polaris can import Word (.docx), Markdown (.md) and plain text (.txt) files.",
  tooLarge: "This file is larger than 10 MB, so Polaris can’t import it.",
  unreadable:
    "Polaris couldn’t read this file. It may be damaged, or not the kind of file its name says.",
  corruptDocx:
    "Polaris couldn’t read this Word document. It may be damaged, or not really a .docx file. Try opening it in Word and saving it again.",
  binary: "This doesn’t look like a text file, so Polaris can’t import it as one.",
};

export type ImportProgress =
  | { stage: "reading"; fraction: number | null }
  | { stage: "converting" }
  | { stage: "saving" };

function readFile(file: File, onProgress: (fraction: number | null) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => onProgress(e.lengthComputable ? e.loaded / e.total : null);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new ImportError(IMPORT_ERRORS.unreadable));
    reader.readAsArrayBuffer(file);
  });
}

/** UTF-8, or Windows-1252 for older files that are not valid UTF-8. */
export function decodeText(data: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder("windows-1252").decode(data);
  }
  if (text.includes("\u0000")) throw new ImportError(IMPORT_ERRORS.binary);
  return text;
}

/** Converts a file the writer chose. Throws ImportError with a message to show them. */
export async function convertFile(
  file: File,
  onProgress: (progress: ImportProgress) => void = () => {},
): Promise<ImportedDocument> {
  const kind = importKind(file.name);
  if (!kind) throw new ImportError(IMPORT_ERRORS.unsupported(file.name));
  if (file.size > IMPORT_MAX_BYTES) throw new ImportError(IMPORT_ERRORS.tooLarge);
  onProgress({ stage: "reading", fraction: 0 });
  const data = await readFile(file, (fraction) => onProgress({ stage: "reading", fraction }));
  onProgress({ stage: "converting" });
  if (kind === "docx") {
    const { docxToDocument, DocxReadError } = await import("./docx");
    try {
      return await docxToDocument(data, file.name);
    } catch (e) {
      if (e instanceof DocxReadError) throw new ImportError(IMPORT_ERRORS.corruptDocx);
      throw e;
    }
  }
  const text = decodeText(data);
  if (kind === "markdown") {
    const { markdownToDocument } = await import("./markdown");
    return markdownToDocument(text, file.name);
  }
  const { textToDocument } = await import("./text");
  return textToDocument(text, file.name);
}
