"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type ExportFormat = "docx" | "md" | "txt" | "print";

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

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
        id={`${id}-menu`}
        role="menu"
        aria-labelledby={`${id}-button`}
        hidden={!open}
        onKeyDown={onMenuKey}
        className="absolute right-0 z-20 mt-1 min-w-52 rounded-md border border-border bg-surface py-1 shadow-lg"
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
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-background focus:bg-accent-soft focus:outline-none"
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p
          role="alert"
          className="absolute right-0 mt-1 w-64 text-xs text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
