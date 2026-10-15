"use client";

import { useState } from "react";
import { CATEGORIES, type Category } from "@/lib/rules/types";
import type { Suggestion } from "@/lib/editor/suggestions";

interface Props {
  suggestions: Suggestion[];
  activeKey: string | null;
  onActivate: (s: Suggestion | null) => void;
  onApply: (s: Suggestion, replacement: string) => void;
  onDismiss: (s: Suggestion) => void;
}

const CATEGORY_COLOR: Record<Category, string> = {
  correctness: "var(--cat-correctness)",
  clarity: "var(--cat-clarity)",
  concision: "var(--cat-concision)",
  formality: "var(--cat-formality)",
  citations: "var(--cat-citations)",
};

export function SuggestionPanel({ suggestions, activeKey, onActivate, onApply, onDismiss }: Props) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<Category, number>;
  for (const s of suggestions) counts[s.category]++;
  const visible = filter === "all" ? suggestions : suggestions.filter((s) => s.category === filter);

  return (
    <aside aria-labelledby="suggestions-heading" className="flex h-full flex-col">
      <div className="flex items-baseline justify-between">
        <h2 id="suggestions-heading" className="font-semibold">
          Suggestions
        </h2>
        <span className="text-sm text-muted" aria-live="polite">
          {suggestions.length === 0 ? "None" : suggestions.length}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
          count={suggestions.length}
        />
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c.id}
            active={filter === c.id}
            onClick={() => setFilter(c.id)}
            label={c.label}
            count={counts[c.id]}
            color={CATEGORY_COLOR[c.id]}
            title={c.description}
          />
        ))}
      </div>

      <ul className="mt-4 flex-1 space-y-2 overflow-y-auto pb-6">
        {visible.length === 0 && (
          <li className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
            {suggestions.length === 0
              ? "Nothing to flag yet. Keep writing."
              : "No suggestions in this category."}
          </li>
        )}
        {visible.map((s) => {
          const active = s.key === activeKey;
          const flagged = s.blockText.slice(s.start, s.end);
          return (
            <li
              key={s.key}
              data-testid="suggestion-card"
              className={`rounded-md border bg-surface text-sm ${active ? "border-accent shadow-sm" : "border-border"}`}
              style={{ borderLeft: `3px solid ${CATEGORY_COLOR[s.category]}` }}
            >
              <button
                type="button"
                aria-expanded={active}
                onClick={() => onActivate(active ? null : s)}
                className="w-full px-3 py-2 text-left"
              >
                <span className="block font-medium">{s.message}</span>
                <span className="mt-0.5 block truncate text-muted">
                  “{flagged.length > 60 ? `${flagged.slice(0, 60)}…` : flagged}”
                </span>
              </button>
              {active && (
                <div className="border-t border-border px-3 py-2">
                  <p className="text-muted">{s.explanation}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.replacements.map((r) => (
                      <button
                        key={r || "(delete)"}
                        type="button"
                        onClick={() => onApply(s, r)}
                        className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-white dark:text-black"
                      >
                        {r === "" ? <>Remove “{flagged}”</> : r}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onDismiss(s)}
                      className="rounded px-2.5 py-1 text-xs text-muted hover:bg-background hover:text-foreground"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  color,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-muted hover:text-foreground"
      }`}
    >
      {color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
