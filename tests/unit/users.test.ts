import type { PrismaClient } from "@prisma/client";
import { compare, getRounds } from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createDocumentService } from "@/lib/documents/service";
import {
  BCRYPT_COST,
  createUserService,
  DUMMY_PASSWORD_HASH,
  EmailTakenError,
  IncorrectPasswordError,
} from "@/lib/users/service";
import { createTestDb } from "./test-db";

// Pass-through spy, so tests can check that an unknown email still pays for a bcrypt compare.
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

// bcrypt at cost 12 takes ~0.4s per hash or compare.
vi.setConfig({ testTimeout: 30_000 });

let db: PrismaClient;
let cleanup: () => Promise<void>;
let service: ReturnType<typeof createUserService>;

let counter = 0;
const uniqueEmail = () => `writer${++counter}@example.com`;
const PASSWORD = "correct horse battery";

beforeAll(() => {
  ({ db, cleanup } = createTestDb());
  service = createUserService(db);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  vi.mocked(compare).mockClear();
});

describe("createUser", () => {
  it("stores a cost-12 bcrypt hash, never the password, and returns no hash", async () => {
    const email = uniqueEmail();
    const user = await service.createUser({ email, password: PASSWORD, name: "Ada" });

    expect(user).toEqual({
      id: expect.any(String),
      email,
      name: "Ada",
      aiEnabled: false,
      createdAt: expect.any(String),
    });
    expect(user).not.toHaveProperty("passwordHash");

    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(getRounds(row.passwordHash)).toBe(BCRYPT_COST);
    expect(BCRYPT_COST).toBe(12);
  });

  it("normalizes the email (trimmed, lowercased) and trims the name", async () => {
    const user = await service.createUser({
      email: "  Grace.Hopper@Example.COM ",
      password: PASSWORD,
      name: "  Grace  ",
    });
    expect(user.email).toBe("grace.hopper@example.com");
    expect(user.name).toBe("Grace");
  });

  it("stores a blank or missing name as null", async () => {
    expect((await service.createUser({ email: uniqueEmail(), password: PASSWORD })).name).toBe(
      null,
    );
    expect(
      (await service.createUser({ email: uniqueEmail(), password: PASSWORD, name: "   " })).name,
    ).toBe(null);
  });

  it("rejects a duplicate email, whatever its case or whitespace", async () => {
    const email = uniqueEmail();
    await service.createUser({ email, password: PASSWORD });
    await expect(service.createUser({ email, password: PASSWORD })).rejects.toBeInstanceOf(
      EmailTakenError,
    );
    await expect(
      service.createUser({ email: ` ${email.toUpperCase()} `, password: PASSWORD }),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("enforces 8 to 128 character passwords", async () => {
    await expect(
      service.createUser({ email: uniqueEmail(), password: "1234567" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      service.createUser({ email: uniqueEmail(), password: "x".repeat(129) }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      service.createUser({ email: uniqueEmail(), password: "12345678" }),
    ).resolves.toMatchObject({ aiEnabled: false });
    await expect(
      service.createUser({ email: uniqueEmail(), password: "x".repeat(128) }),
    ).resolves.toMatchObject({ aiEnabled: false });
  });

  it("rejects invalid emails without creating anything", async () => {
    const before = await db.user.count();
    for (const email of ["", "not-an-email", "a@", "@example.com"]) {
      await expect(service.createUser({ email, password: PASSWORD })).rejects.toBeInstanceOf(
        ZodError,
      );
    }
    expect(await db.user.count()).toBe(before);
  });
});

describe("verifyCredentials", () => {
  it("returns the user for the right password, in any email case", async () => {
    const email = uniqueEmail();
    const created = await service.createUser({ email, password: PASSWORD });
    expect(await service.verifyCredentials(email, PASSWORD)).toEqual(created);
    expect(await service.verifyCredentials(` ${email.toUpperCase()}`, PASSWORD)).toEqual(created);
  });

  it("returns null for a wrong password", async () => {
    const email = uniqueEmail();
    await service.createUser({ email, password: PASSWORD });
    expect(await service.verifyCredentials(email, "wrong password")).toBeNull();
    expect(await service.verifyCredentials(email, PASSWORD.toUpperCase())).toBeNull();
    expect(await service.verifyCredentials(email, "")).toBeNull();
  });

  it("returns null for an unknown email, after comparing against the dummy hash", async () => {
    expect(await service.verifyCredentials("nobody@example.com", PASSWORD)).toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith(PASSWORD, DUMMY_PASSWORD_HASH);
  });

  it("still compares when the email is not even valid", async () => {
    expect(await service.verifyCredentials("not an email", PASSWORD)).toBeNull();
    expect(compare).toHaveBeenCalledWith(PASSWORD, DUMMY_PASSWORD_HASH);
  });

  it("uses a dummy hash as slow as a real one", () => {
    expect(getRounds(DUMMY_PASSWORD_HASH)).toBe(BCRYPT_COST);
  });
});

describe("getUser and updateProfile", () => {
  it("returns null for an unknown id", async () => {
    expect(await service.getUser("missing")).toBeNull();
    expect(await service.updateProfile("missing", { name: "x" })).toBeNull();
  });

  it("updates the name and the AI setting independently", async () => {
    const user = await service.createUser({ email: uniqueEmail(), password: PASSWORD });

    expect(await service.updateProfile(user.id, { name: "  Ada Lovelace " })).toMatchObject({
      name: "Ada Lovelace",
      aiEnabled: false,
    });
    expect(await service.updateProfile(user.id, { aiEnabled: true })).toMatchObject({
      name: "Ada Lovelace",
      aiEnabled: true,
    });
    expect(await service.updateProfile(user.id, { name: "" })).toMatchObject({
      name: null,
      aiEnabled: true,
    });
    expect(await service.getUser(user.id)).toMatchObject({ name: null, aiEnabled: true });
  });

  it("rejects fields that are not part of the profile", async () => {
    const user = await service.createUser({ email: uniqueEmail(), password: PASSWORD });
    await expect(
      // @ts-expect-error: email is not editable through updateProfile
      service.updateProfile(user.id, { email: "new@example.com" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      // @ts-expect-error: aiEnabled must be a boolean
      service.updateProfile(user.id, { aiEnabled: "yes" }),
    ).rejects.toBeInstanceOf(ZodError);
    expect((await service.getUser(user.id))?.email).toBe(user.email);
  });
});

describe("changePassword", () => {
  it("refuses a wrong current password and keeps the old one", async () => {
    const email = uniqueEmail();
    const user = await service.createUser({ email, password: PASSWORD });
    await expect(
      service.changePassword(user.id, "not my password", "a brand new password"),
    ).rejects.toBeInstanceOf(IncorrectPasswordError);
    expect(await service.verifyCredentials(email, PASSWORD)).not.toBeNull();
    expect(await service.verifyCredentials(email, "a brand new password")).toBeNull();
  });

  it("changes the password when the current one is right", async () => {
    const email = uniqueEmail();
    const user = await service.createUser({ email, password: PASSWORD });
    await service.changePassword(user.id, PASSWORD, "a brand new password");
    expect(await service.verifyCredentials(email, "a brand new password")).not.toBeNull();
    expect(await service.verifyCredentials(email, PASSWORD)).toBeNull();
  });

  it("rejects a too-short new password without changing anything", async () => {
    const email = uniqueEmail();
    const user = await service.createUser({ email, password: PASSWORD });
    await expect(service.changePassword(user.id, PASSWORD, "short")).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await service.verifyCredentials(email, PASSWORD)).not.toBeNull();
  });

  it("treats an unknown user like a wrong password", async () => {
    await expect(
      service.changePassword("missing", PASSWORD, "a brand new password"),
    ).rejects.toBeInstanceOf(IncorrectPasswordError);
  });
});

describe("deleteUser", () => {
  it("deletes the user and their documents, and nobody else's", async () => {
    const documents = createDocumentService(db);
    const doomed = await service.createUser({ email: uniqueEmail(), password: PASSWORD });
    const other = await service.createUser({ email: uniqueEmail(), password: PASSWORD });
    await documents.create(doomed.id, { title: "One" });
    await documents.create(doomed.id, { title: "Two" });
    const kept = await documents.create(other.id, { title: "Not mine" });

    expect(await service.deleteUser(doomed.id)).toBe(true);

    expect(await service.getUser(doomed.id)).toBeNull();
    expect(await db.document.count({ where: { userId: doomed.id } })).toBe(0);
    expect(await documents.get(other.id, kept.id)).toMatchObject({ title: "Not mine" });
  });

  it("returns false for an unknown user", async () => {
    expect(await service.deleteUser("missing")).toBe(false);
  });
});
