import type { InputHTMLAttributes } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

/** Labelled input with an optional hint and error, both tied to it with aria-describedby. */
export function FormField({ id, label, hint, error, className, ...input }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        // outline-hidden, not outline-none: it keeps a transparent outline that forced-colors
        // (High Contrast) mode paints, since that mode drops the box-shadow focus ring.
        className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-hidden focus:border-accent focus:ring-2 focus:ring-accent/30 aria-[invalid=true]:border-red-600"
        {...input}
      />
      {hint && (
        // wrap-anywhere: hints can quote an email address, which has no natural break points.
        <p id={hintId} className="mt-1 text-xs text-muted wrap-anywhere">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
