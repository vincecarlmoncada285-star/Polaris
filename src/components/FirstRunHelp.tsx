"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readLocal, writeLocal } from "@/lib/local-storage";

/** localStorage key: set once the writer has dismissed the card, in this browser. */
export const FIRST_RUN_DISMISSED_KEY = "polaris:first-run-dismissed";

/**
 * "How Polaris works", on a document that opened empty, until the writer dismisses it (which
 * this browser remembers). Hidden in the first render, which must match the server's: the
 * server cannot know whether it was dismissed.
 */
export function FirstRunHelp({
  emptyDocument,
  aiEnabled,
}: {
  /** Whether the document had no text when it was opened. */
  emptyDocument: boolean;
  /** The writer's AI setting, once known. */
  aiEnabled: boolean | null;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (emptyDocument && readLocal(FIRST_RUN_DISMISSED_KEY) !== "1") setShow(true);
  }, [emptyDocument]);
  if (!show) return null;

  const dismiss = () => {
    writeLocal(FIRST_RUN_DISMISSED_KEY, "1");
    setShow(false);
  };

  return (
    <section
      aria-labelledby="first-run-heading"
      className="mt-4 rounded-lg border border-border bg-accent-soft px-5 py-4 text-sm"
      data-print="hide"
      data-testid="first-run-help"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="first-run-heading" className="font-semibold">
          How Polaris works
        </h2>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-md px-2 py-0.5 text-muted underline hover:text-foreground"
        >
          Got it
        </button>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Underlines appear as you type. Select one to see why it was flagged and what you could do;
          nothing changes unless you choose it.
        </li>
        <li>
          {aiEnabled ? (
            <>
              AI suggestions and reviews by Claude are on for your account; you can turn them off
              in{" "}
            </>
          ) : (
            <>
              AI suggestions and reviews by Claude are optional, and off until you turn them on
              in{" "}
            </>
          )}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          .
        </li>
        <li>
          The <strong>Overview</strong> tab describes your draft with writing measures; the{" "}
          <strong>Review</strong> tab asks for feedback on the whole document.
        </li>
        <li>
          Import a Word, Markdown or text file from your documents list, and use{" "}
          <strong>Export</strong> to download this one. Press Shift+? for keyboard shortcuts.
        </li>
      </ul>
    </section>
  );
}
