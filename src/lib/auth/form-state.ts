export type AuthField = "name" | "email" | "password" | "confirmPassword";

/** What the sign-in and sign-up server actions hand back to their forms. */
export interface AuthFormState {
  /** Form-level error, announced with role="alert". */
  error?: string;
  fieldErrors?: Partial<Record<AuthField, string>>;
  /** Non-secret values to put back in the fields after a failed submit. */
  values?: { name?: string; email?: string };
}
