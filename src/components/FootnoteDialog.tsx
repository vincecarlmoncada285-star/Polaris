"use client";

import { useEffect, useRef, useState } from "react";
import { FOOTNOTE_MAX_CHARS, type FootnoteTarget } from "@/lib/editor/footnote";
import { formatNumber } from "@/lib/text/format";

export type FootnoteAction =
  | { kind: "save"; content: string }
  | { kind: "delete" }
  | { kind: "cancel" };

/**
 * Edits one footnote's text. The dialog closes itself before reporting what the writer chose,
 * so the browser's own focus restoration (to the toolbar button, say) happens first and the
 * caller can then put the cursor back in the text.
 */
export function FootnoteDialog({
  target,
  onDone,
}: {
  target: FootnoteTarget | null;
  onDone: (target: FootnoteTarget, action: FootnoteAction) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  // The footnote the open dialog is for, until the writer has chosen (Escape included).
  const pending = useRef<FootnoteTarget | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      pending.current = target;
      setText(target.content);
      dialog.showModal();
    } else if (!target && dialog.open) {
      pending.current = null;
      dialog.close();
    }
  }, [target]);

  const finish = (action: FootnoteAction) => {
    const current = pending.current;
    pending.current = null;
    ref.current?.close();
    if (current) onDone(current, action);
  };

  const blank = text.trim() === "";

  return (
    <dialog
      ref={ref}
      // Escape, or the dialog closed some other way: nothing is saved.
      onClose={() => pending.current && finish({ kind: "cancel" })}
      aria-labelledby="footnote-dialog-heading"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blank) finish({ kind: "save", content: text });
        }}
        className="space-y-4 p-6"
      >
        <h2 id="footnote-dialog-heading" className="text-lg font-semibold">
          {target ? `Footnote ${target.number}` : "Footnote"}
        </h2>
        <div className="text-sm">
          <label htmlFor="footnote-text" className="font-medium">
            Footnote text
          </label>
          <textarea
            id="footnote-text"
            value={text}
            maxLength={FOOTNOTE_MAX_CHARS}
            rows={5}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="footnote-text-hint"
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 font-serif"
          />
          <p id="footnote-text-hint" className="mt-1 text-xs text-muted">
            Plain text, up to {formatNumber(FOOTNOTE_MAX_CHARS)} characters (
            {formatNumber(text.length)} used). Footnotes are not counted in the word count.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {/* For a footnote just inserted, Delete takes the marker back out. */}
          <button
            type="button"
            onClick={() => finish({ kind: "delete" })}
            className="mr-auto rounded-md px-4 py-2 text-sm text-red-700 hover:bg-background dark:text-red-400"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => finish({ kind: "cancel" })}
            className="rounded-md px-4 py-2 text-sm text-muted hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={blank}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black"
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
