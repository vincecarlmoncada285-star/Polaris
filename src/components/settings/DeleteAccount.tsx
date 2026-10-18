"use client";

import { useState } from "react";
import { forgetSearch } from "@/lib/documents/library";
import { FormField } from "../FormField";
import { errorMessage } from "./api";
import { SectionCard } from "./SectionCard";

export function DeleteAccount({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toLowerCase() === email;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: typed }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not delete your account."));
      // The response already cleared the session cookie; a full load drops all client state.
      forgetSearch();
      window.location.assign("/signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete your account.");
      setPending(false);
    }
  }

  return (
    <SectionCard id="delete" title="Delete account" tone="danger">
      <form onSubmit={onSubmit} aria-busy={pending} className="space-y-4">
        <p className="text-sm text-muted">
          This permanently deletes your account and every document in it. It cannot be undone.
        </p>
        <FormField
          id="delete-confirm"
          name="email"
          type="email"
          label="Type your account email to confirm"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          hint={`Your account email is ${email}.`}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {/* Disabled until the email matches; only aria-disabled while deleting, so focus stays
            on the button if the request fails. */}
        <button
          type="submit"
          disabled={!confirmed}
          aria-disabled={pending || undefined}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 aria-disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </SectionCard>
  );
}
