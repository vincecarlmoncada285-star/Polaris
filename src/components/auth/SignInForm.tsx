"use client";

import { useActionState } from "react";
import { signInAction } from "@/lib/auth/actions";
import type { AuthFormState } from "@/lib/auth/form-state";
import { FormField } from "../FormField";
import { useAnnouncementKey } from "./useAnnouncement";

const initialState: AuthFormState = {};

export function SignInForm({ callbackUrl, notice }: { callbackUrl: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, initialState);
  const alertKey = useAnnouncementKey(state);

  return (
    <form
      action={action}
      // A second submit while one is running is dropped here, because the button uses
      // aria-disabled (which keeps keyboard focus on it) rather than disabled.
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      aria-busy={pending}
      className="space-y-4"
    >
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {notice && (
        <p role="status" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      )}
      {state.error && (
        <p
          key={alertKey}
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      <FormField
        id="signin-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
      />
      <FormField
        id="signin-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <button
        type="submit"
        aria-disabled={pending || undefined}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white aria-disabled:opacity-60 dark:text-black"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
