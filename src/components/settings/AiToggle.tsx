"use client";

import { useState } from "react";
import { errorMessage, patchMe } from "./api";
import { SectionCard } from "./SectionCard";

// Must describe exactly what the editor sends (src/lib/editor/ai-scheduler.ts, DocumentEditor).
export const AI_EXPLANATION =
  "When on, Polaris sends each paragraph you write or edit to Anthropic's Claude API for suggestions, with the document title and the paragraph before it as context. Opening a document sends nothing until you change it. Polaris keeps Claude's suggestions in server memory for up to 24 hours, and stores your text only in your documents.";

export const AI_NOT_CONFIGURED =
  "AI suggestions aren’t set up on this server, so this setting has no effect for now.";

export function AiToggle({
  enabled: initial,
  configured,
}: {
  enabled: boolean;
  /** Whether the server has Anthropic credentials. */
  configured: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (saving) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setStatus("");
    setError(null);
    try {
      const res = await patchMe({ aiEnabled: next });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save this setting."));
      setStatus(next ? "AI suggestions are on." : "AI suggestions are off.");
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : "Could not save this setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard id="ai" title="AI suggestions">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2 text-sm text-muted">
          <p id="ai-description">{AI_EXPLANATION}</p>
          {!configured && <p id="ai-server-note">{AI_NOT_CONFIGURED}</p>}
        </div>
        {/* Named by the section heading. aria-disabled rather than disabled, so focus stays
            on the switch while saving. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="ai-heading"
          aria-describedby={configured ? "ai-description" : "ai-description ai-server-note"}
          aria-disabled={saving || undefined}
          onClick={toggle}
          className="flex shrink-0 items-center gap-2 rounded-full text-sm font-medium"
        >
          {/* Track border and thumb both use strong colours (at least 3:1 against what is
              behind them, WCAG 1.4.11) in either state, so the switch reads as a control even
              when it is off. */}
          <span
            aria-hidden
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
              enabled ? "border-accent bg-accent" : "border-muted bg-background"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full shadow transition-transform ${
                enabled ? "translate-x-6 bg-surface" : "translate-x-1 bg-muted"
              }`}
            />
          </span>
          {/* Text as well as colour, so the state is not signalled by colour alone. */}
          <span aria-hidden className="w-7 text-left">
            {enabled ? "On" : "Off"}
          </span>
        </button>
      </div>
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
