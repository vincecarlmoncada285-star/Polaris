"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DocumentSummary } from "@/lib/documents/service";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function DocumentLibrary({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocuments);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDocument() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: "{}" });
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
    <section aria-labelledby="library-heading">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 id="library-heading" className="font-serif text-3xl font-semibold">
          Your documents
        </h1>
        <button
          type="button"
          onClick={createDocument}
          disabled={creating}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:text-black"
        >
          {creating ? "Creating…" : "New document"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {docs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted">
          <p className="font-serif text-lg">No documents yet.</p>
          <p className="mt-1 text-sm">Start one and Polaris will give feedback as you write.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {docs.map((doc) => (
            <li key={doc.id} className="group flex items-start gap-4 p-4">
              <Link href={`/documents/${doc.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium group-hover:text-accent">{doc.title}</p>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {doc.excerpt || <em>Empty document</em>}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {doc.wordCount.toLocaleString()} words · edited{" "}
                  {dateFormat.format(new Date(doc.updatedAt))}
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
    </section>
  );
}
