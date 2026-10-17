// What an import left out, and how the editor tells the writer once the document opens.
import { formatNumber } from "@/lib/text/format";

/** Content an import could not keep, by kind. */
export interface DroppedCounts {
  images: number;
  tables: number;
  comments: number;
  /** Deleted text from tracked changes (Word): not part of the document as it reads. */
  trackedChanges: number;
  /** Embedded media and frames (video, audio, iframes, objects, drawings). */
  embedded: number;
}

export const noneDropped = (): DroppedCounts => ({
  images: 0,
  tables: 0,
  comments: 0,
  trackedChanges: 0,
  embedded: 0,
});

const NAMES: { key: keyof DroppedCounts; one: string; many: string }[] = [
  { key: "images", one: "image", many: "images" },
  { key: "tables", one: "table", many: "tables" },
  { key: "comments", one: "comment", many: "comments" },
  { key: "trackedChanges", one: "tracked deletion", many: "tracked deletions" },
  { key: "embedded", one: "embedded object", many: "embedded objects" },
];

/** "2 images and 1 table were left out.", or null when nothing was. */
export function droppedSummary(dropped: DroppedCounts): string | null {
  const parts = NAMES.filter(({ key }) => dropped[key] > 0).map(
    ({ key, one, many }) => `${formatNumber(dropped[key])} ${dropped[key] === 1 ? one : many}`,
  );
  if (parts.length === 0) return null;
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  const total = NAMES.reduce((n, { key }) => n + dropped[key], 0);
  return `${list} ${total === 1 ? "was" : "were"} left out.`;
}

/** Where the title's footnotes went (a title is plain text), or null when it had none. */
export function titleFootnotesSummary(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "The title’s footnote is now at the start of the text."
    : `The title’s ${formatNumber(count)} footnotes are now at the start of the text.`;
}

/** What the new document says once it opens: where it came from, and what changed on the way. */
export function importNotice(fileName: string, dropped: DroppedCounts, titleFootnotes: number) {
  return [
    `Imported from ${fileName}.`,
    droppedSummary(dropped),
    titleFootnotesSummary(titleFootnotes),
  ]
    .filter(Boolean)
    .join(" ");
}

const key = (documentId: string) => `polaris:import-notice:${documentId}`;

/** Remembers, for this tab, what to tell the writer when the imported document opens. */
export function saveImportNotice(documentId: string, message: string): void {
  try {
    sessionStorage.setItem(key(documentId), message);
  } catch {
    // Storage blocked: the document is imported all the same, just without the note.
  }
}

/** The note for a document that was just imported, once; null for any other document. */
export function readImportNotice(documentId: string): string | null {
  try {
    const message = sessionStorage.getItem(key(documentId));
    if (message !== null) sessionStorage.removeItem(key(documentId));
    return message;
  } catch {
    return null;
  }
}
