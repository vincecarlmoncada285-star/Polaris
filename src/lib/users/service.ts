import type { PrismaClient } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import {
  createUserSchema,
  emailSchema,
  passwordSchema,
  updateProfileSchema,
  type CreateUserInput,
  type UpdateProfileInput,
} from "./schema";

export const BCRYPT_COST = 12;

/**
 * A real cost-12 hash of a throwaway string. Signing in as an unknown email compares against
 * it, so the response takes as long as for a real account and timing does not reveal which
 * emails are registered.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$LTB8Jrcmc3btZc0ZkTJKBOgPfZgFdmACTXiws.YPvGAMoXAEDxxdm";

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  aiEnabled: boolean;
  createdAt: string;
}

/**
 * A user as a session sees it: with the version every session JWT must carry (see
 * `sessionVersion` in prisma/schema.prisma). Server-side only; never sent to the browser.
 */
export type SessionUser = UserDTO & { sessionVersion: number };

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "EmailTakenError";
  }
}

/** The caller's session was revoked (the session version moved on) while it was asking. */
export class SessionRevokedError extends Error {
  constructor() {
    super("This session has been signed out");
    this.name = "SessionRevokedError";
  }
}

export class IncorrectPasswordError extends Error {
  constructor() {
    super("Current password is incorrect");
    this.name = "IncorrectPasswordError";
  }
}

const userSelect = { id: true, email: true, name: true, aiEnabled: true, createdAt: true } as const;

type Row = { id: string; email: string; name: string | null; aiEnabled: boolean; createdAt: Date };

const sessionUserSelect = { ...userSelect, sessionVersion: true } as const;

function toDTO(row: Row): UserDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    aiEnabled: row.aiEnabled,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSessionUser(row: Row & { sessionVersion: number }): SessionUser {
  return { ...toDTO(row), sessionVersion: row.sessionVersion };
}

function prismaCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

// Note: bcrypt only reads the first 72 bytes of a password; PASSWORD_MAX (128) allows longer
// passphrases, whose tail then does not affect the hash.
export function createUserService(db: PrismaClient) {
  return {
    /** Throws ZodError for invalid input and EmailTakenError for a duplicate email. */
    async createUser(input: CreateUserInput): Promise<UserDTO> {
      const { email, password, name } = createUserSchema.parse(input);
      // Cheap early exit; the unique index below is what actually guarantees it.
      if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new EmailTakenError();
      }
      const passwordHash = await hash(password, BCRYPT_COST);
      try {
        const row = await db.user.create({
          data: { email, name: name ?? null, passwordHash },
          select: userSelect,
        });
        return toDTO(row);
      } catch (e) {
        if (prismaCode(e) === "P2002") throw new EmailTakenError();
        throw e;
      }
    },

    /**
     * The user for this email and password, or null. Takes the same time either way. Carries
     * the session version, which the new session's JWT is issued with.
     */
    async verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
      const parsed = emailSchema.safeParse(email);
      const row = parsed.success
        ? await db.user.findUnique({
            where: { email: parsed.data },
            select: { ...sessionUserSelect, passwordHash: true },
          })
        : null;
      if (!row) {
        await compare(password, DUMMY_PASSWORD_HASH);
        return null;
      }
      return (await compare(password, row.passwordHash)) ? toSessionUser(row) : null;
    },

    async getUser(id: string): Promise<UserDTO | null> {
      const row = await db.user.findUnique({ where: { id }, select: userSelect });
      return row ? toDTO(row) : null;
    },

    /** The user and their current session version, for checking a session against. */
    async getSessionUser(id: string): Promise<{ user: UserDTO; sessionVersion: number } | null> {
      const row = await db.user.findUnique({ where: { id }, select: sessionUserSelect });
      return row ? { user: toDTO(row), sessionVersion: row.sessionVersion } : null;
    },

    /** Throws ZodError for invalid input; null when the user does not exist. */
    async updateProfile(id: string, input: UpdateProfileInput): Promise<UserDTO | null> {
      const data = updateProfileSchema.parse(input);
      try {
        return toDTO(await db.user.update({ where: { id }, data, select: userSelect }));
      } catch (e) {
        if (prismaCode(e) === "P2025") return null;
        throw e;
      }
    },

    /**
     * Throws IncorrectPasswordError unless `current` matches, ZodError for a weak `next`, and
     * SessionRevokedError when the session version is no longer `expectedVersion` (the one the
     * caller's session was checked against). Raises the session version in the same write, so
     * every session issued before the change is signed out, and returns the new version (for
     * re-issuing the caller's own session).
     */
    async changePassword(
      id: string,
      current: string,
      next: string,
      expectedVersion: number,
    ): Promise<number> {
      const nextPassword = passwordSchema.parse(next);
      const row = await db.user.findUnique({ where: { id }, select: { passwordHash: true } });
      if (!row) {
        await compare(current, DUMMY_PASSWORD_HASH);
        throw new IncorrectPasswordError();
      }
      if (!(await compare(current, row.passwordHash))) throw new IncorrectPasswordError();
      const passwordHash = await hash(nextPassword, BCRYPT_COST);
      // Compare-and-swap on the old hash (if the password changed while we were hashing, the
      // check above was against a stale value) and on the session version (if this session
      // was revoked meanwhile, it must not raise the version and re-issue itself past it).
      const { count } = await db.user.updateMany({
        where: { id, passwordHash: row.passwordHash, sessionVersion: expectedVersion },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      if (count === 1) return expectedVersion + 1;
      const now = await db.user.findUnique({ where: { id }, select: { sessionVersion: true } });
      if (!now || now.sessionVersion !== expectedVersion) throw new SessionRevokedError();
      throw new IncorrectPasswordError();
    },

    /**
     * Raises the session version, which signs out every session issued before (the caller
     * re-issues its own). Only from `expectedVersion`, the one the caller's session was checked
     * against: a session revoked since then cannot raise it again and outlive the revocation.
     * The new version, or null when the user does not exist or is past that version.
     */
    async revokeSessions(id: string, expectedVersion: number): Promise<number | null> {
      const { count } = await db.user.updateMany({
        where: { id, sessionVersion: expectedVersion },
        data: { sessionVersion: { increment: 1 } },
      });
      return count === 1 ? expectedVersion + 1 : null;
    },

    /** Deletes the user and, through the foreign key, all their documents. */
    async deleteUser(id: string): Promise<boolean> {
      const { count } = await db.user.deleteMany({ where: { id } });
      return count > 0;
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
