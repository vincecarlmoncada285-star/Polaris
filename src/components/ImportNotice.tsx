"use client";

import { useEffect, useRef, useState } from "react";
import { readImportNotice } from "@/lib/import/notice";

/**
 * What the importer left out of a document, said once when it first opens. The live region is
 * always rendered, empty until there is a notice: screen readers announce text added to a region
 * they already know, not a region that arrives with its text.
 */
export function ImportNotice({ documentId }: { documentId: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  // Read once per document: reading takes the notice out of sessionStorage, and React runs
  // effects twice in development (Strict Mode), so a second read would find nothing.
  const read = useRef<{ documentId: string; notice: string | null } | null>(null);
  useEffect(() => {
    if (read.current?.documentId !== documentId) {
      read.current = { documentId, notice: readImportNotice(documentId) };
    }
    setNotice(read.current.notice);
  }, [documentId]);

  return (
    <div
      className={
        notice
          ? "mt-4 flex items-start gap-3 rounded-md border border-border bg-accent-soft px-4 py-3 text-sm"
          : undefined
      }
      data-print="hide"
      data-testid={notice ? "import-notice" : undefined}
    >
      <p role="status" className="min-w-0 flex-1">
        {notice}
      </p>
      {notice && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="shrink-0 text-muted underline hover:text-foreground"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
