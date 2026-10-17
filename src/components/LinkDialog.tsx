"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeLinkInput } from "@/lib/editor/links";

export interface LinkRequest {
  /** The link the cursor or selection is in, or "" for none. */
  href: string;
  /** Whether there is text to link: a selection, or an existing link. */
  hasText: boolean;
}

/** An href to set ("" removes the link), or null when the writer cancelled. */
export type LinkResult = string | null;

export const LINK_ERROR =
  "Enter a web address (such as https://example.com) or an email address. Only http, https and mailto links are allowed.";

/**
 * Adds, changes or removes the link on the selection. The address is checked here; an empty
 * field removes the link. Closes itself before reporting, like the footnote dialog, so the
 * caller can put focus back in the text.
 */
export function LinkDialog({
  request,
  onDone,
}: {
  request: LinkRequest | null;
  onDone: (result: LinkResult) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      pending.current = true;
      setValue(request.href);
      setError(false);
      dialog.showModal();
    } else if (!request && dialog.open) {
      pending.current = false;
      dialog.close();
    }
  }, [request]);

  const finish = (result: LinkResult) => {
    if (!pending.current) return;
    pending.current = false;
    ref.current?.close();
    onDone(result);
  };

  return (
    <dialog
      ref={ref}
      onClose={() => finish(null)}
      aria-labelledby="link-dialog-heading"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      <form
        method="dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const href = normalizeLinkInput(value);
          if (href === null) {
            setError(true);
            return;
          }
          finish(href);
        }}
        className="space-y-4 p-6"
      >
        <h2 id="link-dialog-heading" className="text-lg font-semibold">
          {request?.href ? "Edit link" : "Add link"}
        </h2>
        <div className="text-sm">
          <label htmlFor="link-url" className="font-medium">
            Web address
          </label>
          <input
            id="link-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(false);
            }}
            aria-invalid={error || undefined}
            aria-describedby={error ? "link-url-error" : "link-url-hint"}
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2"
          />
          {error ? (
            <p
              id="link-url-error"
              role="alert"
              className="mt-1 text-xs text-red-700 dark:text-red-400"
            >
              {LINK_ERROR}
            </p>
          ) : (
            <p id="link-url-hint" className="mt-1 text-xs text-muted">
              {request?.hasText
                ? "Leave it empty to remove the link."
                : "With no text selected, the address itself is added as the link text."}{" "}
              Ctrl-click (Cmd-click on a Mac) a link to open it.
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {request?.href && (
            <button
              type="button"
              onClick={() => finish("")}
              className="mr-auto rounded-md px-4 py-2 text-sm text-red-700 hover:bg-background dark:text-red-400"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={() => finish(null)}
            className="rounded-md px-4 py-2 text-sm text-muted hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black"
          >
            Save link
          </button>
        </div>
      </form>
    </dialog>
  );
}
