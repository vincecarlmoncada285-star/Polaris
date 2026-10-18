// The library's search and sort, in the browser: pure functions over the summaries the page
// already has, so typing in the search box filters with no request.
import type { DocumentSummary } from "./service";

export const LIBRARY_SORTS = [
  { id: "edited", label: "Last edited" },
  { id: "title", label: "Title A-Z" },
  { id: "words", label: "Word count" },
] as const;

export type LibrarySort = (typeof LIBRARY_SORTS)[number]["id"];

export const DEFAULT_SORT: LibrarySort = "edited";

export function isLibrarySort(value: unknown): value is LibrarySort {
  return LIBRARY_SORTS.some((s) => s.id === value);
}

/** Lowercased, accents dropped, runs of space as one: "Café  NOTES" and "cafe notes" match. */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The documents whose title or excerpt contains every word of the query, in any order and
 * either field ("climate draft" finds a "Climate essay" whose excerpt says "draft"). A blank
 * query keeps them all.
 */
export function searchDocuments(
  docs: readonly DocumentSummary[],
  query: string,
): DocumentSummary[] {
  const words = foldForSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...docs];
  return docs.filter((doc) => {
    const haystack = `${foldForSearch(doc.title)} ${foldForSearch(doc.excerpt)}`;
    return words.every((word) => haystack.includes(word));
  });
}

const titleCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

const byEdited = (a: DocumentSummary, b: DocumentSummary) =>
  b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : 0;

/**
 * A sorted copy. Last edited: newest first. Title: A to Z, ignoring case and accents, with
 * numbers in order ("Essay 2" before "Essay 10"). Word count: longest first. Ties fall back
 * to the most recently edited.
 */
export function sortDocuments(
  docs: readonly DocumentSummary[],
  sort: LibrarySort,
): DocumentSummary[] {
  const compare =
    sort === "title"
      ? (a: DocumentSummary, b: DocumentSummary) =>
          titleCollator.compare(a.title.trim(), b.title.trim()) || byEdited(a, b)
      : sort === "words"
        ? (a: DocumentSummary, b: DocumentSummary) => b.wordCount - a.wordCount || byEdited(a, b)
        : byEdited;
  return [...docs].sort(compare);
}

/** What the library shows: the search applied, then the sort. */
export function libraryView(
  docs: readonly DocumentSummary[],
  query: string,
  sort: LibrarySort,
): DocumentSummary[] {
  return sortDocuments(searchDocuments(docs, query), sort);
}
