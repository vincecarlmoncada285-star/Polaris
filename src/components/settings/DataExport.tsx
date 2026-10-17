"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/text/format";
import { SectionCard, primaryButton } from "./SectionCard";

/** What the download contains: shown before the button, so the writer knows. */
export const DATA_EXPORT_EXPLANATION =
  "Downloads a .zip file with one Markdown (.md) file per document, holding its title, text, headings, lists, links and footnotes, and a manifest.json that lists each document’s title, when it was created and last edited, its word count and its writing goals. Saved reviews and suggestions are not included. The file is put together in your browser.";

export function DataExport() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus("Preparing your documents…");
    try {
      const [{ buildArchive, fetchAllDocuments, archiveFileName }, { downloadBlob }] =
        await Promise.all([import("@/lib/export/archive"), import("@/lib/export/download")]);
      const docs = await fetchAllDocuments(
        (url) => fetch(url, { cache: "no-store" }),
        (fetched, total) =>
          setStatus(`Fetched ${formatNumber(fetched)} of ${formatNumber(total)} documents…`),
      );
      const zip = await buildArchive(docs);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      downloadBlob(blob, archiveFileName());
      setStatus(
        `Downloaded ${formatNumber(docs.length)} ${docs.length === 1 ? "document" : "documents"}.`,
      );
    } catch {
      setStatus("");
      setError("Couldn’t prepare the download. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard id="data-export" title="Your data">
      <p id="data-export-description" className="text-sm text-muted">
        {DATA_EXPORT_EXPLANATION}
      </p>
      <button
        type="button"
        onClick={download}
        aria-disabled={busy || undefined}
        aria-describedby="data-export-description"
        className={`${primaryButton} mt-4`}
      >
        {busy ? "Preparing…" : "Download all my documents"}
      </button>
      <p role="status" className="mt-3 min-h-5 text-sm text-muted">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
