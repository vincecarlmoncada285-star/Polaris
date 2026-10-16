"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CATEGORIES, type Category } from "@/lib/rules/types";
import type { AiStatus } from "@/lib/editor/ai-scheduler";
import type { Suggestion } from "@/lib/editor/suggestions";

/**
 * What the panel says about AI suggestions. "loading" until the editor knows; "unknown" when it
 * could not find out (it keeps asking).
 */
export type AiPanelState =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "off" }
  | { kind: "not_configured" }
  | { kind: "on"; status: AiStatus };

interface Props {
  suggestions: Suggestion[];
  activeKey: string | null;
  ai: AiPanelState;
  onActivate: (s: Suggestion | null) => void;
  onApply: (s: Suggestion, replacement: string) => void;
  onDismiss: (s: Suggestion) => void;
}

export const AI_NOTE = "Suggested by Claude. Check that it keeps your meaning.";

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<
  Category,
  string
>;

const OFF_LINE = (
  <>
    AI suggestions are off. Turn them on in{" "}
    <Link href="/settings" className="underline hover:text-foreground">
      Settings
    </Link>
    .
  </>
);
const NOT_CONFIGURED_LINE = "AI suggestions aren’t set up on this server.";
const UNAVAILABLE_LINE = "AI suggestions unavailable";

/**
 * How things stand when the document opens. Plain text, never announced: a screen reader
 * hearing "AI suggestions are off" on every visit would be the nag this line avoids.
 */
function aiNote(ai: AiPanelState): ReactNode {
  if (ai.kind === "off") return OFF_LINE;
  if (ai.kind === "not_configured") return NOT_CONFIGURED_LINE;
  if (ai.kind === "unknown") return UNAVAILABLE_LINE;
  return null;
}

/** Longer than this, "a moment" would mislead: it is the daily limit (or similar). */
const LONG_PAUSE_MS = 5 * 60_000;

function pausedLine(until: number, now: number): string {
  if (until - now <= LONG_PAUSE_MS)
    return "AI suggestions paused for a moment (too many requests).";
  const at = new Date(until);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const when =
    at.toDateString() === new Date(now).toDateString()
      ? time
      : at.toDateString() === tomorrow.toDateString()
        ? `tomorrow at ${time}`
        : at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return `AI suggestions paused until ${when} (usage limit reached).`;
}

/** What the AI checks are doing, announced as it changes. Empty while idle: never a nag. */
export function aiStatusLine(status: AiStatus, now = Date.now()): ReactNode {
  switch (status.kind) {
    case "idle":
      return null;
    case "checking":
      return `Checking ${status.count} ${status.count === 1 ? "paragraph" : "paragraphs"}…`;
    case "unavailable":
      if (status.reason === "disabled") return OFF_LINE;
      if (status.reason === "not_configured") return NOT_CONFIGURED_LINE;
      return "AI suggestions unavailable: sign in again to get them.";
    case "error":
      return status.reason === "rate_limited" ? pausedLine(status.until, now) : UNAVAILABLE_LINE;
  }
}

const CATEGORY_COLOR: Record<Category, string> = {
  correctness: "var(--cat-correctness)",
  clarity: "var(--cat-clarity)",
  concision: "var(--cat-concision)",
  formality: "var(--cat-formality)",
  citations: "var(--cat-citations)",
};

export function SuggestionPanel({
  suggestions,
  activeKey,
  ai,
  onActivate,
  onApply,
  onDismiss,
}: Props) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<Category, number>;
  for (const s of suggestions) counts[s.category]++;
  const visible = filter === "all" ? suggestions : suggestions.filter((s) => s.category === filter);
  const note = aiNote(ai);

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
      <div data-testid="ai-status" className="mt-1 min-h-4 text-xs text-muted">
        {note && <p>{note}</p>}
        {/* Always rendered, so a screen reader is listening before the first change. */}
        <p role="status" aria-live="polite">
          {ai.kind === "on" ? aiStatusLine(ai.status) : null}
        </p>
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
                {/* The category in words, so colour is never the only signal. */}
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  {CATEGORY_LABEL[s.category]}
                  {s.source === "ai" && (
                    <span
                      title={AI_NOTE}
                      className="rounded border border-accent px-1 text-[0.65rem] font-semibold leading-4 text-accent"
                    >
                      AI
                    </span>
                  )}
                </span>
                <span className="block font-medium">{s.message}</span>
                <span className="mt-0.5 block truncate text-muted">
                  “{flagged.length > 60 ? `${flagged.slice(0, 60)}…` : flagged}”
                </span>
              </button>
              {active && (
                <div className="border-t border-border px-3 py-2">
                  <p className="text-muted">{s.explanation}</p>
                  {s.source === "ai" && <p className="mt-1 text-xs text-muted">{AI_NOTE}</p>}
                  {/* No replacement means "rephrase it yourself": only Dismiss, no fake fix. */}
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
