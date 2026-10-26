import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A real database (a fresh SQLite file); only the session is a stand-in.
const testDb = vi.hoisted(async () => (await import("./test-db")).createTestDb());
vi.mock("@/lib/db", async () => ({ prisma: (await testDb).db }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));

import { POST as CREATE } from "@/app/api/documents/route";
import { GET as READ, PATCH, DELETE } from "@/app/api/documents/[id]/route";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import {
  CREATES_PER_HOUR,
  documentWrites,
  LARGE_SAVE_CHARS,
  MAX_DOCUMENTS_PER_USER,
  MAX_STORED_CHARS_PER_USER,
  SAVES_PER_MINUTE,
} from "@/lib/documents/limits";
import { EXCERPT_CHARS } from "@/lib/documents/service";
import { crossSiteRefusal, readJson } from "@/lib/http/request";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let alice: string;

beforeAll(async () => {
  ({ db, cleanup } = await testDb);
  alice = (await db.user.create({ data: { email: "alice@example.com", passwordHash: "x" } })).id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue(alice);
  documentWrites.creates.reset();
  documentWrites.saves.reset();
});

const JSON_HEADERS = { "Content-Type": "application/json" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
  PATCH(
    new Request(`http://localhost/api/documents/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

/** A body that arrives in chunks with no Content-Length, as a streaming client sends it. */
function chunked(totalBytes: number): Request {
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Request("http://localhost/x", {
    method: "POST",
    headers: JSON_HEADERS,
    body,
    // @ts-expect-error Node's fetch needs this for a streamed body.
    duplex: "half",
  });
}

describe("readJson", () => {
  it("refuses anything but JSON, so an HTML form cannot post to the API", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"title":"x"}',
    });
    const read = await readJson(req, 1024);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.response.status).toBe(415);
  });

  it("refuses a declared length over the cap without reading it", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { ...JSON_HEADERS, "Content-Length": String(10 * 1024 * 1024) },
      body: "{}",
    });
    const read = await readJson(req, 1024);
    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(413);
  });

  it("stops reading a chunked body as soon as it passes the cap", async () => {
    const started = performance.now();
    const read = await readJson(chunked(512 * 1024 * 1024), 1024 * 1024);
    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(413);
    // Half a gigabyte would take far longer to buffer than this.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("refuses broken JSON and accepts good JSON", async () => {
    const bad = await readJson(
      new Request("http://localhost/x", { method: "POST", headers: JSON_HEADERS, body: "{" }),
      1024,
    );
    expect(bad.ok ? 0 : bad.response.status).toBe(400);
    const good = await readJson(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: '{"a":1}',
      }),
      1024,
    );
    expect(good).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("crossSiteRefusal", () => {
  const withSite = (site?: string) =>
    new Request("http://localhost/x", { headers: site ? { "Sec-Fetch-Site": site } : {} });
  it.each(["cross-site", "same-site"])("refuses a request the browser marks %s", (site) => {
    expect(crossSiteRefusal(withSite(site))?.status).toBe(403);
  });
  it.each(["same-origin", "none", undefined])("allows %s", (site) => {
    expect(crossSiteRefusal(withSite(site))).toBeNull();
  });
});

describe("PATCH /api/documents/:id", () => {
  it("answers with the new version, not the whole document", async () => {
    const doc = await documents.create(alice);
    const res = await patch(doc.id, { plainText: "One two three.", baseVersion: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: doc.id, version: 1, wordCount: 3 });
    expect(body).not.toHaveProperty("plainText");
    expect(body).not.toHaveProperty("content");
  });

  it("refuses a save from an out-of-date copy with 409 and the current version", async () => {
    const doc = await documents.create(alice);
    expect((await patch(doc.id, { title: "Tab one", baseVersion: 0 })).status).toBe(200);
    const res = await patch(doc.id, { title: "Tab two", baseVersion: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict", version: 1 });
    expect((await documents.get(alice, doc.id))?.title).toBe("Tab one");
  });

  it("refuses a cross-site request and a form-encoded body", async () => {
    const doc = await documents.create(alice);
    expect(
      (await patch(doc.id, { title: "x" }, { ...JSON_HEADERS, "Sec-Fetch-Site": "same-site" }))
        .status,
    ).toBe(403);
    expect((await patch(doc.id, { title: "x" }, { "Content-Type": "text/plain" })).status).toBe(
      415,
    );
    expect((await documents.get(alice, doc.id))?.title).toBe("Untitled document");
  });

  it("is rate limited per user", async () => {
    const doc = await documents.create(alice);
    for (let i = 0; i < SAVES_PER_MINUTE; i++) documentWrites.saves.hit(alice);
    const res = await patch(doc.id, { title: "x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("checks a large save against the storage limit, leaving out the text it replaces", async () => {
    const doc = await documents.create(alice);
    const usage = vi.spyOn(documents, "usage");
    try {
      const big = { plainText: "a".repeat(LARGE_SAVE_CHARS) };
      usage.mockResolvedValue({
        documents: 1,
        chars: MAX_STORED_CHARS_PER_USER - LARGE_SAVE_CHARS,
      });
      expect((await patch(doc.id, big)).status).toBe(200);
      expect(usage).toHaveBeenCalledWith(alice, doc.id);

      usage.mockResolvedValue({ documents: 1, chars: MAX_STORED_CHARS_PER_USER - 10 });
      const res = await patch(doc.id, big);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "storage_limit" });

      // Small saves do not pay for the check.
      usage.mockClear();
      expect((await patch(doc.id, { title: "Small" })).status).toBe(200);
      expect(usage).not.toHaveBeenCalled();
    } finally {
      usage.mockRestore();
    }
  });

  it("refuses a cross-site delete", async () => {
    const doc = await documents.create(alice);
    const res = await DELETE(
      new Request(`http://localhost/api/documents/${doc.id}`, {
        method: "DELETE",
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
      ctx(doc.id),
    );
    expect(res.status).toBe(403);
    expect(await documents.get(alice, doc.id)).not.toBeNull();
  });
});

describe("GET /api/documents/:id?fields=version", () => {
  it("returns only the version and save time", async () => {
    const doc = await documents.create(alice);
    await documents.update(alice, doc.id, { title: "Saved" });
    const res = await READ(
      new Request(`http://localhost/api/documents/${doc.id}?fields=version`),
      ctx(doc.id),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["updatedAt", "version"]);
    expect(body.version).toBe(1);
  });
});

describe("POST /api/documents limits", () => {
  const create = (body: unknown = {}) =>
    CREATE(
      new Request("http://localhost/api/documents", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    );

  it("is rate limited per user", async () => {
    for (let i = 0; i < CREATES_PER_HOUR; i++) documentWrites.creates.hit(alice);
    expect((await create()).status).toBe(429);
  });

  it("stops at the per-user document limit", async () => {
    const carol = (
      await db.user.create({ data: { email: "carol@example.com", passwordHash: "x" } })
    ).id;
    vi.mocked(requireUser).mockResolvedValue(carol);
    await db.document.createMany({
      data: Array.from({ length: MAX_DOCUMENTS_PER_USER }, () => ({ userId: carol })),
    });
    const res = await create();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "document_limit" });
  });
});

describe("the library list", () => {
  it("cuts the excerpt in the database", async () => {
    const dave = (await db.user.create({ data: { email: "dave@example.com", passwordHash: "x" } }))
      .id;
    const doc = await documents.create(dave);
    await documents.update(dave, doc.id, { plainText: "x".repeat(50_000) });
    const [summary] = await documents.list(dave);
    expect(summary!.excerpt).toBe("x".repeat(EXCERPT_CHARS));
  });
});
