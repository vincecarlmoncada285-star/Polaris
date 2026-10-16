"use client";

import { useEffect, useRef, useState } from "react";
import { TARGET_WORDS_MAX, TARGET_WORDS_MIN, type WritingGoals } from "@/lib/documents/schema";
import { formatNumber } from "@/lib/text/format";

type ChoiceKey = Exclude<keyof WritingGoals, "targetWords">;

const FIELDS: {
  key: ChoiceKey;
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "documentType",
    label: "Document type",
    options: [
      { value: "essay", label: "Essay" },
      { value: "research-paper", label: "Research paper" },
      { value: "thesis", label: "Thesis / dissertation" },
      { value: "lab-report", label: "Lab report" },
      { value: "literature-review", label: "Literature review" },
    ],
  },
  {
    key: "audience",
    label: "Audience",
    options: [
      { value: "expert", label: "Experts in the field" },
      { value: "knowledgeable", label: "Knowledgeable readers" },
      { value: "general", label: "General audience" },
    ],
  },
  {
    key: "formality",
    label: "Formality",
    options: [
      { value: "formal", label: "Formal" },
      { value: "neutral", label: "Neutral" },
    ],
  },
  {
    key: "citationStyle",
    label: "Citation style",
    options: [
      { value: "apa", label: "APA (7th)" },
      { value: "mla", label: "MLA (9th)" },
      { value: "chicago", label: "Chicago" },
      { value: "ieee", label: "IEEE" },
    ],
  },
];

export function GoalsDialog({
  open,
  goals,
  onClose,
  onSave,
}: {
  open: boolean;
  goals: WritingGoals;
  onClose: () => void;
  onSave: (goals: WritingGoals) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(goals);
  // As typed: the number input's own validation (min, max, step) blocks a bad value on submit.
  const [target, setTarget] = useState(goals.targetWords?.toString() ?? "");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(goals);
      setTarget(goals.targetWords?.toString() ?? "");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, goals]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="goals-heading"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={() => {
          const words = target.trim() === "" ? undefined : Number(target);
          const next = { ...draft };
          if (words === undefined) delete next.targetWords;
          else next.targetWords = words;
          onSave(next);
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 id="goals-heading" className="text-lg font-semibold">
            Writing goals
          </h2>
          <p className="mt-1 text-sm text-muted">
            Polaris tailors its suggestions to what you are writing and who will read it.
          </p>
        </div>
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="font-medium">{f.label}</span>
            <select
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value || undefined }))}
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="">Not set</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="text-sm">
          {/* The hint sits outside the label: it is the field's description, not its name. */}
          <label className="block">
            <span className="font-medium">Target length (words)</span>
            <input
              type="number"
              inputMode="numeric"
              min={TARGET_WORDS_MIN}
              max={TARGET_WORDS_MAX}
              step={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-describedby="target-words-hint"
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <p id="target-words-hint" className="mt-1 text-xs text-muted">
            Optional. A whole number from {TARGET_WORDS_MIN} to {formatNumber(TARGET_WORDS_MAX)};
            the Overview shows your progress towards it.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-black"
          >
            Save goals
          </button>
        </div>
      </form>
    </dialog>
  );
}
