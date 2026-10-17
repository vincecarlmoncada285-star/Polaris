"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export type ExportFormat = "docx" | "md" | "txt" | "print";

/** The space kept between a popup and the edge of the screen, in pixels. */
const SCREEN_MARGIN = 8;

const ITEMS: { format: ExportFormat; label: string }[] = [
  { format: "docx", label: "Word (.docx)" },
  { format: "md", label: "Markdown (.md)" },
  { format: "txt", label: "Plain text (.txt)" },
  { format: "print", label: "Print / Save as PDF" },
];

/**
 * A WAI-ARIA menu button: Enter, Space, Down or a click opens the menu on its first item, Up on its
 * last; Up and Down move (wrapping), Home and End jump, Escape closes it and returns to the
 * button, Tab closes it and moves on. Choosing an item closes the menu first.
 */
export function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => Promise<void> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The menu and the error hang below the button, lined up with its right edge; with the button
  // near the left of a narrow screen that would run off it, so they line up with its left edge.
  const [alignLeft, setAlignLeft] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open && !error) return;
    const button = buttonRef.current?.getBoundingClientRect();
    if (!button) return;
    const width = Math.max(menuRef.current?.offsetWidth ?? 0, errorRef.current?.offsetWidth ?? 0);
    setAlignLeft(button.right - width < SCREEN_MARGIN);
  }, [open, error]);

  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const show = (index: number) => {
    // A choice now replaces whatever went wrong with the last one.
    setError(null);
    setFocusIndex(index);
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  async function choose(format: ExportFormat) {
    close(true);
    setBusy(true);
    setError(null);
    try {
      await onExport(format);
    } catch {
      setError("Couldn’t export this document. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space open it through the button's own click.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      show(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      show(ITEMS.length - 1);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = ITEMS.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: focusIndex === last ? 0 : focusIndex + 1,
      ArrowUp: focusIndex === 0 ? last : focusIndex - 1,
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setFocusIndex(moves[e.key]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="relative" data-print="hide">
      <button
        ref={buttonRef}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-busy={busy || undefined}
        onClick={() => (open ? close(false) : show(0))}
        onKeyDown={onButtonKey}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground"
      >
        {busy ? "Exporting…" : "Export"} <span aria-hidden>▾</span>
      </button>
      <ul
        ref={menuRef}
        id={`${id}-menu`}
        role="menu"
        aria-labelledby={`${id}-button`}
        hidden={!open}
        onKeyDown={onMenuKey}
        className={`absolute z-20 mt-1 min-w-52 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-surface py-1 shadow-lg ${alignLeft ? "left-0" : "right-0"}`}
      >
        {ITEMS.map((item, i) => (
          <li key={item.format} role="none">
            <button
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => void choose(item.format)}
              onMouseEnter={() => setFocusIndex(i)}
              // A visible outline, not just a tint: it shows in forced-colours mode too.
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-background focus:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div
          ref={errorRef}
          className={`absolute z-20 mt-1 flex w-64 max-w-[calc(100vw-1rem)] items-start gap-2 rounded-md border border-border bg-surface p-2 text-xs shadow-lg ${alignLeft ? "left-0" : "right-0"}`}
        >
          <p role="alert" className="min-w-0 flex-1 text-red-700 dark:text-red-400">
            {error}
          </p>
          <button
            type="button"
            aria-label="Dismiss the export error"
            onClick={() => {
              setError(null);
              buttonRef.current?.focus();
            }}
            className="shrink-0 text-muted underline hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
