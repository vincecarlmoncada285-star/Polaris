import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentService } from "@/lib/documents/service";
import { updateDocumentSchema } from "@/lib/documents/schema";
import { createTestDb } from "./test-db";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let service: ReturnType<typeof createDocumentService>;
let alice: string;
let bob: string;

const makeUser = async (email: string) =>
  (await db.user.create({ data: { email, passwordHash: "not-a-real-hash" } })).id;

beforeAll(async () => {
  ({ db, cleanup } = createTestDb());
  service = createDocumentService(db);
  alice = await makeUser("alice@example.com");
  bob = await makeUser("bob@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("document service", () => {
  it("creates, updates, lists and deletes", async () => {
    const created = await service.create(alice);
    expect(created.title).toBe("Untitled document");

    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello there world" }] }],
    };
    const updated = await service.update(alice, created.id, {
      title: "Essay",
      content,
      plainText: "Hello there world",
      goals: { citationStyle: "apa" },
    });
    expect(updated).toMatchObject({
      title: "Essay",
      wordCount: 3,
      content,
      goals: { citationStyle: "apa" },
    });

    const list = await service.list(alice);
    expect(list.find((d) => d.id === created.id)).toMatchObject({
      title: "Essay",
      excerpt: "Hello there world",
    });

    expect(await service.remove(alice, created.id)).toBe(true);
    expect(await service.get(alice, created.id)).toBeNull();
  });

  it("returns null/false for missing documents", async () => {
    expect(await service.get(alice, "missing")).toBeNull();
    expect(await service.update(alice, "missing", { title: "x" })).toBeNull();
    expect(await service.remove(alice, "missing")).toBe(false);
  });

  it("falls back to the default title when cleared", async () => {
    const doc = await service.create(alice, { title: "Draft" });
    expect((await service.update(alice, doc.id, { title: "" }))?.title).toBe("Untitled document");
  });

  it("bumps updatedAt on update and lists the most recently edited first", async () => {
    const older = await service.create(alice, { title: "Older" });
    const newer = await service.create(alice, { title: "Newer" });
    await new Promise((r) => setTimeout(r, 10));
    const touched = await service.update(alice, older.id, { title: "Older, edited" });
    expect(Date.parse(touched!.updatedAt)).toBeGreaterThan(Date.parse(older.updatedAt));

    const ids = (await service.list(alice)).map((d) => d.id);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
  });

  it("does not create documents for users that do not exist", async () => {
    await expect(service.create("no-such-user")).rejects.toThrow();
  });
});

describe("document ownership", () => {
  it("lists only the user's own documents", async () => {
    const mine = await service.create(alice, { title: "Alice's notes" });
    const theirs = await service.create(bob, { title: "Bob's notes" });

    const aliceIds = (await service.list(alice)).map((d) => d.id);
    const bobIds = (await service.list(bob)).map((d) => d.id);
    expect(aliceIds).toContain(mine.id);
    expect(aliceIds).not.toContain(theirs.id);
    expect(bobIds).toEqual([theirs.id]);
  });

  it("treats another user's document as missing on get", async () => {
    const doc = await service.create(alice, { title: "Private" });
    expect(await service.get(bob, doc.id)).toBeNull();
    expect(await service.get(alice, doc.id)).not.toBeNull();
  });

  it("refuses to update another user's document and leaves it unchanged", async () => {
    const doc = await service.create(alice, { title: "Original" });
    expect(
      await service.update(bob, doc.id, { title: "Hijacked", plainText: "Overwritten text" }),
    ).toBeNull();

    const after = await service.get(alice, doc.id);
    expect(after).toMatchObject({ title: "Original", plainText: "", wordCount: 0 });
    expect(after?.updatedAt).toBe(doc.updatedAt);
  });

  it("refuses to delete another user's document and keeps it", async () => {
    const doc = await service.create(alice, { title: "Keep me" });
    expect(await service.remove(bob, doc.id)).toBe(false);
    expect(await service.get(alice, doc.id)).toMatchObject({ title: "Keep me" });
  });
});

describe("update schema", () => {
  it("rejects unknown goal values", () => {
    expect(updateDocumentSchema.safeParse({ goals: { citationStyle: "harvard" } }).success).toBe(
      false,
    );
    expect(updateDocumentSchema.safeParse({ goals: { citationStyle: "mla" } }).success).toBe(true);
  });
});
