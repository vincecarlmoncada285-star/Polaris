"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NAME_MAX } from "@/lib/users/constants";
import { FormField } from "../FormField";
import { errorMessage, patchMe } from "./api";
import { primaryButton, SectionCard } from "./SectionCard";

export function ProfileForm({ name: initialName, email }: { name: string | null; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The button is aria-disabled (not disabled, which would drop keyboard focus) while saving.
    if (pending) return;
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const res = await patchMe({ name });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save your name."));
      setSaved(true);
      // The navbar is a server component; re-render it with the new name.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SectionCard id="profile" title="Profile">
      <form onSubmit={onSubmit} aria-busy={pending} className="space-y-4">
        <p className="text-sm text-muted">
          Signed in as <span className="font-medium text-foreground wrap-anywhere">{email}</span>
        </p>
        <FormField
          id="profile-name"
          name="name"
          label="Display name"
          autoComplete="name"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          hint="Shown in the navigation bar. Leave blank to show your email."
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="submit" aria-disabled={pending || undefined} className={primaryButton}>
            {pending ? "Saving…" : "Save name"}
          </button>
          <span role="status" className="text-sm text-muted">
            {saved ? "Saved" : ""}
          </span>
        </div>
      </form>
    </SectionCard>
  );
}
