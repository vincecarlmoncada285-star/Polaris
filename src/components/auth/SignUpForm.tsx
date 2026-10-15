"use client";

import { useActionState } from "react";
import { signUpAction } from "@/lib/auth/actions";
import type { AuthFormState } from "@/lib/auth/form-state";
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/users/constants";
import { FormField } from "../FormField";
import { useAnnouncementKey } from "./useAnnouncement";

const initialState: AuthFormState = {};

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, initialState);
  const alertKey = useAnnouncementKey(state);
  const errors = state.fieldErrors ?? {};
  // One announcement for the whole submit: the form error, or every field error in order.
  const announcement =
    state.error ??
    [errors.name, errors.email, errors.password, errors.confirmPassword].filter(Boolean).join(" ");

  return (
    <form
      action={action}
      // Drops a second submit while one is running; see SignInForm for why not `disabled`.
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
      aria-busy={pending}
      className="space-y-4"
    >
      {announcement && (
        <p
          key={alertKey}
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {announcement}
        </p>
      )}
      <FormField
        id="signup-name"
        name="name"
        label="Name (optional)"
        autoComplete="name"
        maxLength={NAME_MAX}
        defaultValue={state.values?.name}
        error={errors.name}
      />
      <FormField
        id="signup-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={errors.email}
      />
      <FormField
        id="signup-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`}
        error={errors.password}
      />
      <FormField
        id="signup-confirm"
        name="confirmPassword"
        type="password"
        label="Confirm password"
        autoComplete="new-password"
        required
        maxLength={PASSWORD_MAX}
        error={errors.confirmPassword}
      />
      <button
        type="submit"
        aria-disabled={pending || undefined}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white aria-disabled:opacity-60 dark:text-black"
      >
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
