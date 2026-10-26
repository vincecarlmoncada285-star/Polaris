"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CredentialsSignin } from "next-auth";
import { z } from "zod";
import { RateLimitedSignIn, signIn, signOut } from "@/auth";
import { users } from "@/lib/users";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/users/schema";
import { EmailTakenError, PasswordBusyError } from "@/lib/users/service";
import { sanitizeCallbackUrl } from "./callback-url";
import type { AuthField, AuthFormState } from "./form-state";
import { clientIp, limits, RATE_LIMITED_MESSAGE } from "./limits";
import { ACCOUNT_CREATED_PATH, SIGN_IN_PATH } from "./routes";
import { domainsText, emailAllowed, SIGNUP_CLOSED_MESSAGE, signupPolicy } from "./signup-policy";

// One message for unknown email and wrong password alike, so the form does not reveal
// which emails have accounts.
const INVALID_CREDENTIALS = "Email or password is incorrect";

const signUpSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = field(form, "email");
  const password = field(form, "password");
  const values = { email };
  if (!email.trim() || !password) return { error: "Enter your email and password.", values };

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: sanitizeCallbackUrl(form.get("callbackUrl")),
    });
  } catch (e) {
    if (e instanceof RateLimitedSignIn) return { error: RATE_LIMITED_MESSAGE, values };
    if (e instanceof CredentialsSignin) return { error: INVALID_CREDENTIALS, values };
    throw e; // Includes the redirect that signals success.
  }
  return {};
}

export async function signUpAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const input = {
    name: field(form, "name"),
    email: field(form, "email"),
    password: field(form, "password"),
    confirmPassword: field(form, "confirmPassword"),
  };
  const values = { name: input.name, email: input.email };

  const policy = signupPolicy();
  if (!policy.open) return { error: SIGNUP_CLOSED_MESSAGE, values };

  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: AuthFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as AuthField;
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }

  if (!emailAllowed(parsed.data.email, policy)) {
    return {
      fieldErrors: { email: `Use your ${domainsText(policy.domains)} email address.` },
      values,
    };
  }

  // Counted after validation, so typos in the form do not use up the allowance.
  if (!limits.signUp.hit(clientIp(await headers())).ok) {
    return { error: RATE_LIMITED_MESSAGE, values };
  }

  const { name, email, password } = parsed.data;
  try {
    await users.createUser({ name, email, password });
  } catch (e) {
    if (e instanceof EmailTakenError) {
      return { fieldErrors: { email: "An account with this email already exists." }, values };
    }
    if (e instanceof PasswordBusyError) return { error: RATE_LIMITED_MESSAGE, values };
    throw e;
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (e) {
    // The account exists; only the automatic sign-in failed (e.g. rate limited). Say so on the
    // sign-in page, or the writer cannot tell that the account was created.
    if (e instanceof CredentialsSignin) redirect(ACCOUNT_CREATED_PATH);
    throw e;
  }
  return {};
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: SIGN_IN_PATH });
}
