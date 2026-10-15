"use client";

import { useEffect, useRef, useState } from "react";
import type { WritingGoals } from "@/lib/documents/schema";

const FIELDS: {
  key: keyof WritingGoals;
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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(goals);
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
      <form method="dialog" onSubmit={() => onSave(draft)} className="space-y-4 p-6">
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
