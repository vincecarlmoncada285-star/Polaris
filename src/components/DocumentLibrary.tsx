"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import {
  DEFAULT_SORT,
  LIBRARY_SORTS,
  LIBRARY_SORT_KEY,
  isLibrarySort,
  libraryView,
  rememberSearch,
  rememberedSearch,
  type LibrarySort,
} from "@/lib/documents/library";
import type { DocumentSummary } from "@/lib/documents/service";
import { MAX_CONTENT_BYTES } from "@/lib/documents/schema";
import { IMPORT_ACCEPT, ImportError, convertFile, type ImportProgress } from "@/lib/import";
import { importNotice, saveImportNotice } from "@/lib/import/notice";
import { readLocal, writeLocal } from "@/lib/local-storage";
import { formatNumber } from "@/lib/text/format";
import { LocalDateTime } from "./LocalDateTime";

const IMPORT_FAILED = "Polaris couldn’t import this file. Please try again.";
const IMPORT_TOO_BIG =
  "This document is too large to import: once converted it is over 5 MB. Try splitting it into parts.";

/** "3 documents", or "2 of 3 documents" while a search hides some. */
export function resultCountText(shown: number, total: number): string {
  const noun = total === 1 ? "document" : "documents";
  return shown === total
    ? `${formatNumber(total)} ${noun}`
    : `${formatNumber(shown)} of ${formatNumber(total)} ${noun}`;
}

const subscribe = () => () => {};

function progressText(file: string, p: ImportProgress): string {
  if (p.stage === "reading") {
    return `Reading ${file}…${p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""}`;
  }
  return p.stage === "converting" ? `Converting ${file}…` : "Saving the new document…";
}

export function DocumentLibrary({
  initialDocuments,
  userId,
}: {
  initialDocuments: DocumentSummary[];
  /** Whose library this is: the remembered search is theirs alone. */
  userId: string;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocuments);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ file: string; progress: ImportProgress } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  // The first render matches the server's (no storage there); the remembered search and sort
  // are applied right after.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_SORT);
  useEffect(() => {
    const storedSort = readLocal(LIBRARY_SORT_KEY);
    if (isLibrarySort(storedSort)) setSort(storedSort);
    const storedQuery = rememberedSearch(userId);
    if (storedQuery) setQuery(storedQuery);
  }, [userId]);
  const shown = useMemo(() => libraryView(docs, query, sort), [docs, query, sort]);
  // False in the server's render and during hydration, true once the controls respond: the
  // page can stream in behind its loading skeleton, and tests wait for this before acting.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const search = (value: string) => {
    setQuery(value);
    rememberSearch(userId, value);
  };

  /**
   * Converts the file here in the browser and creates a document from the result: the file
   * itself is never uploaded. A file that cannot be read creates nothing.
   */
  async function importDocument(file: File) {
    if (importing || creating) return;
    setError(null);
    setImporting({ file: file.name, progress: { stage: "reading", fraction: 0 } });
    try {
      const imported = await convertFile(file, (progress) =>
        setImporting({ file: file.name, progress }),
      );
      const body = JSON.stringify({
        title: imported.title,
        content: imported.content,
        plainText: imported.plainText,
      });
      if (JSON.stringify(imported.content).length > MAX_CONTENT_BYTES) {
        throw new ImportError(IMPORT_TOO_BIG);
      }
      setImporting({ file: file.name, progress: { stage: "saving" } });
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new ImportError(res.status === 400 ? IMPORT_TOO_BIG : IMPORT_FAILED);
      const doc = (await res.json()) as { id: string };
      saveImportNotice(
        doc.id,
        importNotice(
          file.name,
          imported.dropped,
          imported.titleFootnotes,
          imported.shortenedFootnotes,
        ),
      );
      router.push(`/documents/${doc.id}`);
    } catch (e) {
      setError(e instanceof ImportError ? e.message : IMPORT_FAILED);
      setImporting(null);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length > 1) {
      setError("Drop one file at a time.");
      return;
    }
    if (files[0]) void importDocument(files[0]);
  };

  async function createDocument() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error();
      const doc = (await res.json()) as { id: string };
      router.push(`/documents/${doc.id}`);
    } catch {
      setError("Could not create a document. Please try again.");
      setCreating(false);
    }
  }

  async function deleteDocument(doc: DocumentSummary) {
    if (!window.confirm(`Delete “${doc.title}”? This cannot be undone.`)) return;
    const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok) setDocs((d) => d.filter((x) => x.id !== doc.id));
    else setError("Could not delete the document.");
  }

  return (
    <section aria-labelledby="library-heading" data-ready={hydrated || undefined}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 id="library-heading" className="font-serif text-3xl font-semibold">
          Your documents
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={!!importing}
            aria-describedby="import-hint"
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-60"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          {/* Opened by the Import button; labelled for assistive tech and tests. */}
          <input
            ref={fileInput}
            type="file"
            accept={IMPORT_ACCEPT}
            aria-label="Import a file"
            tabIndex={-1}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importDocument(file);
            }}
          />
          <button
            type="button"
            onClick={createDocument}
            disabled={creating}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:text-black"
          >
            {creating ? "Creating…" : "New document"}
          </button>
        </div>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="import-drop-zone"
        className={`mb-6 rounded-lg border-2 border-dashed px-4 py-3 text-sm text-muted ${
          dragging ? "border-accent bg-accent-soft" : "border-border"
        }`}
      >
        <p id="import-hint">
          Import a Word (.docx), Markdown (.md) or plain text (.txt) file of up to 10 MB, or drop
          one here. It is converted in your browser; only the new document is saved.
        </p>
        {/* Always rendered, empty when nothing is being imported, so a screen reader is
            listening before the first message: it announces text added to a live region it
            already knows, not a region that arrives with its text. */}
        <p role="status" className={importing ? "mt-2" : undefined} data-testid="import-progress">
          {importing ? progressText(importing.file, importing.progress) : null}
        </p>
        {importing && (
          <progress
            className="mt-1 h-2 w-full"
            max={1}
            aria-label="Import progress"
            {...(importing.progress.stage === "reading" && importing.progress.fraction !== null
              ? { value: importing.progress.fraction }
              : {})}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted">
          <p className="font-serif text-lg">No documents yet.</p>
          <p className="mt-1 text-sm">Start one and Polaris will give feedback as you write.</p>
        </div>
      ) : (
        <>
          <div role="search" className="mb-2 flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1 text-sm">
              <label htmlFor="library-search" className="font-medium">
                Search documents
              </label>
              <input
                ref={searchInput}
                id="library-search"
                type="search"
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder="Title or text"
                autoComplete="off"
                aria-describedby="library-count"
                className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </div>
            <div className="text-sm">
              <label htmlFor="library-sort" className="font-medium">
                Sort by
              </label>
              <select
                id="library-sort"
                value={sort}
                onChange={(e) => {
                  if (!isLibrarySort(e.target.value)) return;
                  setSort(e.target.value);
                  writeLocal(LIBRARY_SORT_KEY, e.target.value);
                }}
                className="mt-1 block rounded-md border border-border bg-surface px-3 py-2"
              >
                {LIBRARY_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p
            id="library-count"
            role="status"
            className="mb-3 text-sm text-muted"
            data-testid="library-count"
          >
            {resultCountText(shown.length, docs.length)}
          </p>
          {shown.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted">
              <p className="font-serif text-lg">No documents match “{query.trim()}”.</p>
              <p className="mt-1 text-sm">
                Search looks at titles and the start of each document.{" "}
                {/* Back in the search box: this button goes away with the message. */}
                <button
                  type="button"
                  onClick={() => {
                    search("");
                    searchInput.current?.focus();
                  }}
                  className="font-medium text-accent underline"
                >
                  Clear search
                </button>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {shown.map((doc) => (
                <li key={doc.id} className="group flex items-start gap-4 p-4">
                  <Link href={`/documents/${doc.id}`} className="min-w-0 flex-1">
                    <p
                      className="truncate font-medium group-hover:text-accent"
                      data-testid="library-item-title"
                    >
                      {doc.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">
                      {doc.excerpt || <em>Empty document</em>}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {formatNumber(doc.wordCount)} words · edited{" "}
                      <LocalDateTime iso={doc.updatedAt} />
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteDocument(doc)}
                    className="rounded px-2 py-1 text-sm text-muted hover:bg-background hover:text-red-600"
                    aria-label={`Delete ${doc.title}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
