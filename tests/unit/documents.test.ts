import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentService, DocumentConflictError } from "@/lib/documents/service";
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
    expect(updated).toMatchObject({ id: created.id, wordCount: 3, version: 1 });
    expect(await service.get(alice, created.id)).toMatchObject({
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
    await service.update(alice, doc.id, { title: "" });
    expect((await service.get(alice, doc.id))?.title).toBe("Untitled document");
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

describe("usage", () => {
  it("counts a user's documents and stored characters, optionally leaving one out", async () => {
    const carol = await makeUser("carol@example.com");
    expect(await service.usage(carol)).toEqual({ documents: 0, chars: 0 });
    const content = { type: "doc", content: [] };
    const a = await service.create(carol, { title: "A", content, plainText: "hello" });
    await service.create(carol, { title: "B", content, plainText: "hi" });
    const dave = await makeUser("dave@example.com");
    await service.create(dave, { title: "Not Carol's", content, plainText: "x".repeat(100) });
    const size = JSON.stringify(content).length;
    expect(await service.usage(carol)).toEqual({ documents: 2, chars: 2 * size + 7 });
    expect(await service.usage(carol, a.id)).toEqual({ documents: 2, chars: size + 2 });
  });
});

describe("document versions", () => {
  it("starts at 0 and raises the version on every save", async () => {
    const doc = await service.create(alice);
    expect(doc.version).toBe(0);
    expect((await service.update(alice, doc.id, { title: "One" }))?.version).toBe(1);
    expect((await service.update(alice, doc.id, { title: "Two" }))?.version).toBe(2);
    expect(await service.version(alice, doc.id)).toMatchObject({ version: 2 });
  });

  it("refuses a save made from an older version, and changes nothing", async () => {
    const doc = await service.create(alice, { title: "Original" });
    await service.update(alice, doc.id, { title: "From tab A", baseVersion: 0 });
    // Tab B still has version 0: its save must not overwrite tab A's.
    const stale = service.update(alice, doc.id, { title: "From tab B", baseVersion: 0 });
    await expect(stale).rejects.toBeInstanceOf(DocumentConflictError);
    await expect(stale).rejects.toMatchObject({ version: 1 });
    expect((await service.get(alice, doc.id))?.title).toBe("From tab A");
  });

  it("is a 404, not a conflict, for someone else's document", async () => {
    const doc = await service.create(alice);
    expect(await service.update(bob, doc.id, { title: "x", baseVersion: 0 })).toBeNull();
    expect(await service.version(bob, doc.id)).toBeNull();
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
  it.each([50, 2000, 200_000])("accepts a word target of %i", (targetWords) => {
    expect(updateDocumentSchema.safeParse({ goals: { targetWords } }).success).toBe(true);
  });

  it.each([49, 0, -100, 200_001, 1500.5, "2000", null])(
    "rejects a word target of %j",
    (targetWords) => {
      expect(updateDocumentSchema.safeParse({ goals: { targetWords } }).success).toBe(false);
    },
  );

  it("keeps the word target optional, and stores it with the other goals", async () => {
    expect(updateDocumentSchema.safeParse({ goals: { citationStyle: "apa" } }).success).toBe(true);
    const doc = await service.create(alice);
    await service.update(alice, doc.id, { goals: { targetWords: 2000 } });
    expect((await service.get(alice, doc.id))?.goals).toEqual({ targetWords: 2000 });
  });

  it("rejects unknown goal values", () => {
    expect(updateDocumentSchema.safeParse({ goals: { citationStyle: "harvard" } }).success).toBe(
      false,
    );
    expect(updateDocumentSchema.safeParse({ goals: { citationStyle: "mla" } }).success).toBe(true);
  });
});
