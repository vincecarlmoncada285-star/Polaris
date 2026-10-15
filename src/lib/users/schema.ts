import { z } from "zod";
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from "./constants";

/** Emails are stored trimmed and lowercased, so lookups are case-insensitive. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

/** Display name: blank means "no name", stored as null. */
export const nameSchema = z
  .string()
  .trim()
  .max(NAME_MAX, `Use at most ${NAME_MAX} characters.`)
  .transform((v) => (v === "" ? null : v));

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema.nullish(),
});

export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateProfileSchema = z
  .object({
    name: nameSchema.nullable(),
    aiEnabled: z.boolean(),
  })
  .partial()
  .strict();

export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(1024),
    newPassword: passwordSchema,
  })
  .strict();

export const deleteAccountSchema = z.object({ email: z.string().max(1024) }).strict();
