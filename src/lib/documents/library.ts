// The library's search and sort, in the browser: pure functions over the summaries the page
// already has, so typing in the search box filters with no request. And how both are
// remembered in this browser.
import { readLocal, writeLocal } from "@/lib/local-storage";
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

/** localStorage keys: the library's search (and whose it is) and sort, in this browser. */
export const LIBRARY_SEARCH_KEY = "polaris:library-search";
export const LIBRARY_SORT_KEY = "polaris:library-sort";

/**
 * The search `userId` last left in the library in this browser, or "". A search can say what
 * someone is writing about, so it is kept with the account it belongs to: on a shared computer
 * the next person to sign in never sees it (and it is dropped then).
 */
export function rememberedSearch(userId: string): string {
  const stored = readLocal(LIBRARY_SEARCH_KEY);
  if (stored === null) return "";
  try {
    const value = JSON.parse(stored) as { user?: unknown; query?: unknown } | null;
    if (value?.user === userId && typeof value.query === "string") return value.query;
  } catch {
    // Not ours to read: dropped below.
  }
  writeLocal(LIBRARY_SEARCH_KEY, null);
  return "";
}

/** Remembers `userId`'s search in this browser; a blank one is forgotten. */
export function rememberSearch(userId: string, query: string): void {
  writeLocal(LIBRARY_SEARCH_KEY, query.trim() ? JSON.stringify({ user: userId, query }) : null);
}

/** Forgets the remembered search, when the writer signs out or deletes their account. */
export function forgetSearch(): void {
  writeLocal(LIBRARY_SEARCH_KEY, null);
}
