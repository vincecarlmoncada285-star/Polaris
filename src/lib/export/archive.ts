// "Download all my documents": every document as Markdown in one .zip, with a manifest. Made in
// the browser from GET /api/documents/export, a page at a time.
import { uniqueSlugs } from "./filename";
import { escapeMarkdown, toMarkdown } from "./markdown";
import {
  EXPORT_ENDPOINT,
  EXPORT_PAGE_SIZE,
  type ExportPage,
  type ExportedDocument,
} from "./protocol";

export interface ManifestEntry {
  file: string;
  title: string;
  created: string;
  updated: string;
  wordCount: number;
  goals: ExportedDocument["goals"];
}

/** Every page of the user's documents. Throws if a page cannot be fetched. */
export async function fetchAllDocuments(
  fetchImpl: (url: string) => Promise<Response>,
  onProgress: (fetched: number, total: number) => void = () => {},
): Promise<ExportedDocument[]> {
  const all: ExportedDocument[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(EXPORT_PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const res = await fetchImpl(`${EXPORT_ENDPOINT}?${query}`);
    if (!res.ok) throw new Error(`GET ${EXPORT_ENDPOINT}: ${res.status}`);
    const page = (await res.json()) as ExportPage;
    all.push(...page.documents);
    onProgress(all.length, page.total);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

const isDoc = (content: unknown): content is { type: "doc" } =>
  typeof content === "object" && content !== null && (content as { type?: unknown }).type === "doc";

/** A document as Markdown: from its content, or its plain text if it has no usable content. */
export function documentMarkdown(
  doc: Pick<ExportedDocument, "title" | "content" | "plainText">,
): string {
  if (isDoc(doc.content)) return toMarkdown(doc.content, doc.title);
  const paragraphs = (doc.plainText ?? "")
    .split(/\n[ \t]*\n/)
    .map((p) => escapeMarkdown(p.trim()))
    .filter(Boolean);
  return `${[`# ${escapeMarkdown(doc.title)}`, ...paragraphs].join("\n\n")}\n`;
}

/** The zip: one Markdown file per document (unique names from the titles) and manifest.json. */
export async function buildArchive(docs: readonly ExportedDocument[], exportedAt = new Date()) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const names = uniqueSlugs(docs.map((d) => d.title));
  const manifest: ManifestEntry[] = docs.map((doc, i) => {
    const file = `${names[i]}.md`;
    zip.file(file, documentMarkdown(doc));
    return {
      file,
      title: doc.title,
      created: doc.createdAt,
      updated: doc.updatedAt,
      wordCount: doc.wordCount,
      goals: doc.goals,
    };
  });
  zip.file(
    "manifest.json",
    `${JSON.stringify({ exportedAt: exportedAt.toISOString(), documents: manifest }, null, 2)}\n`,
  );
  return zip;
}

/** The archive's file name, e.g. polaris-documents-2026-10-16.zip. */
export const archiveFileName = (at = new Date()) =>
  `polaris-documents-${at.toISOString().slice(0, 10)}.zip`;
