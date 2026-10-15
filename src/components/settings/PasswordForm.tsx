"use client";

import { useState } from "react";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/users/constants";
import { useAnnouncementKey } from "../auth/useAnnouncement";
import { FormField } from "../FormField";
import { errorMessage } from "./api";
import { primaryButton, SectionCard } from "./SectionCard";

const MISMATCH = "New passwords do not match.";

/**
 * A fresh object for every failed submit: the alert is keyed on it, so the same message twice
 * (two mismatches in a row) is a new alert that screen readers announce again.
 */
interface FormError {
  message: string;
  /** The field the error belongs to, marked aria-invalid and described by the message. */
  field?: "confirmPassword";
}

export function PasswordForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const alertKey = useAnnouncementKey(error);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The button is aria-disabled (not disabled, which would drop keyboard focus) while saving.
    if (pending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    setDone(false);
    if (newPassword !== data.get("confirmPassword")) {
      setError({ message: MISMATCH, field: "confirmPassword" });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not change your password."));
      form.reset();
      setDone(true);
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : "Could not change your password.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <SectionCard id="password" title="Change password">
      <form onSubmit={onSubmit} aria-busy={pending} className="space-y-4">
        {error && (
          <p key={alertKey} role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error.message}
          </p>
        )}
        <FormField
          id="current-password"
          name="currentPassword"
          type="password"
          label="Current password"
          autoComplete="current-password"
          required
        />
        <FormField
          id="new-password"
          name="newPassword"
          type="password"
          label="New password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`}
        />
        <FormField
          id="confirm-new-password"
          name="confirmPassword"
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          required
          maxLength={PASSWORD_MAX}
          error={error?.field === "confirmPassword" ? error.message : undefined}
        />
        <div className="flex items-center gap-3">
          <button type="submit" aria-disabled={pending || undefined} className={primaryButton}>
            {pending ? "Changing…" : "Change password"}
          </button>
          <span role="status" className="text-sm text-muted">
            {done ? "Password changed" : ""}
          </span>
        </div>
      </form>
    </SectionCard>
  );
}
