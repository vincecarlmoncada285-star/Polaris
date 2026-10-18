"use client";

import { useTransition } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { flushPendingSaves } from "@/lib/autosave";
import { forgetSearch } from "@/lib/documents/library";

/**
 * Signing out clears the session cookie before the editor unmounts, so an edit still waiting
 * for its autosave debounce would be sent without a session and refused. So this flushes
 * pending saves first, then runs the sign-out action. It also forgets the library search this
 * browser remembers, which the next person here should not see. Without JavaScript the form
 * still posts the action as usual.
 */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    startTransition(async () => {
      await flushPendingSaves();
      forgetSearch();
      // Redirects to /signin; the router follows it as it would for the form action.
      await signOutAction();
    });
  }

  return (
    <form action={signOutAction} onSubmit={onSubmit} className="shrink-0">
      <button
        type="submit"
        aria-disabled={pending || undefined}
        className="rounded-md border border-border px-2.5 py-1 text-sm text-muted hover:text-foreground aria-disabled:opacity-60"
      >
        Sign out
      </button>
    </form>
  );
}
