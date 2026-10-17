import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A real database (a fresh SQLite file); only the session is a stand-in.
const testDb = vi.hoisted(async () => (await import("./test-db")).createTestDb());
vi.mock("@/lib/db", async () => ({ prisma: (await testDb).db }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { POST } from "@/app/api/documents/route";
import { GET as EXPORT } from "@/app/api/documents/export/route";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { MAX_CONTENT_BYTES } from "@/lib/documents/schema";
import type { ExportPage } from "@/lib/export/protocol";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let alice: string;
let bob: string;
let carol: string;

const content = (text: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text },
        { type: "footnote", attrs: { id: "f", content: "A note." } },
      ],
    },
  ],
});

const exportPage = async (query = "") =>
  EXPORT(new Request(`http://localhost/api/documents/export${query}`));

beforeAll(async () => {
  ({ db, cleanup } = await testDb);
  const make = async (email: string) =>
    (await db.user.create({ data: { email, passwordHash: "x" } })).id;
  alice = await make("alice@example.com");
  bob = await make("bob@example.com");
  carol = await make("carol@example.com");
  for (let i = 0; i < 5; i++) {
    const doc = await documents.create(alice, { title: `Alice ${i}` });
    await documents.update(alice, doc.id, {
      content: content(`alice text ${i}`),
      plainText: `alice text ${i}`,
    });
  }
  for (let i = 0; i < 3; i++) {
    const doc = await documents.create(bob, { title: `Bob ${i}` });
    await documents.update(bob, doc.id, {
      content: content(`bob secret ${i}`),
      plainText: `bob secret ${i}`,
    });
  }
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue(alice);
});

describe("GET /api/documents/export", () => {
  it("returns 401 when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await exportPage()).status).toBe(401);
  });

  it("pages through the user's own documents, with content, and nobody else's", async () => {
    const seen: ExportPage["documents"] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await exportPage(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const page = (await res.json()) as ExportPage;
      expect(page.total).toBe(5);
      expect(page.documents.length).toBeLessThanOrEqual(2);
      seen.push(...page.documents);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.map((d) => d.title).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `Alice ${i}`));
    expect(new Set(seen.map((d) => d.id)).size).toBe(5);
    expect(seen[0]!.content).toMatchObject({ type: "doc" });
    expect(JSON.stringify(seen)).not.toContain("bob secret");
  });

  it("never includes another user's documents, whatever cursor is passed", async () => {
    const bobsIds = (await documents.list(bob)).map((d) => d.id);
    for (const cursor of ["", ...bobsIds, "0", "zzzz"]) {
      const res = await exportPage(`?limit=50${cursor ? `&cursor=${cursor}` : ""}`);
      const page = (await res.json()) as ExportPage;
      for (const doc of page.documents) {
        expect(doc.title).toMatch(/^Alice/);
        expect(bobsIds).not.toContain(doc.id);
      }
    }
    vi.mocked(requireUser).mockResolvedValue(bob);
    const asBob = (await (await exportPage("?limit=50")).json()) as ExportPage;
    expect(asBob.documents.map((d) => d.title).sort()).toEqual(["Bob 0", "Bob 1", "Bob 2"]);
  });

  it("returns an empty export for a user with no documents", async () => {
    vi.mocked(requireUser).mockResolvedValue(carol);
    const page = (await (await exportPage()).json()) as ExportPage;
    expect(page).toEqual({ documents: [], nextCursor: null, total: 0 });
  });

  it("refuses a bad page size", async () => {
    for (const q of ["?limit=0", "?limit=51", "?limit=abc", `?cursor=${"x".repeat(101)}`]) {
      expect((await exportPage(q)).status, q).toBe(400);
    }
  });
});

describe("POST /api/documents with imported content", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("creates the document with its title, content, plain text and word count", async () => {
    const res = await post({
      title: "  Imported essay ",
      content: content("Three words here"),
      plainText: "Three words here",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({
      title: "Imported essay",
      plainText: "Three words here",
      wordCount: 3,
      content: content("Three words here"),
    });
    const stored = await documents.get(alice, created.id);
    expect(stored?.content).toEqual(content("Three words here"));
  });

  it("still creates an empty document from an empty body", async () => {
    const res = await post({});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ title: "Untitled document", wordCount: 0 });
  });

  it("refuses content over the same limits as an update, and creates nothing", async () => {
    const before = await db.document.count({ where: { userId: alice } });
    const huge = { type: "doc", content: [{ type: "text", text: "x".repeat(MAX_CONTENT_BYTES) }] };
    for (const body of [
      { content: huge },
      { plainText: "x".repeat(MAX_CONTENT_BYTES + 1) },
      { title: "x".repeat(201) },
      { plainText: 42 },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(await db.document.count({ where: { userId: alice } })).toBe(before);
  });
});
