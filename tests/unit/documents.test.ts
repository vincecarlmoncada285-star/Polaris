import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentService } from "@/lib/documents/service";
import { updateDocumentSchema } from "@/lib/documents/schema";

let dir: string;
let db: PrismaClient;
let service: ReturnType<typeof createDocumentService>;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "polaris-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  db = new PrismaClient({ datasourceUrl: url });
  service = createDocumentService(db);
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("document service", () => {
  it("creates, updates, lists and deletes", async () => {
    const created = await service.create();
    expect(created.title).toBe("Untitled document");

    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello there world" }] }],
    };
    const updated = await service.update(created.id, {
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

    const list = await service.list();
    expect(list.find((d) => d.id === created.id)).toMatchObject({
      title: "Essay",
      excerpt: "Hello there world",
    });

    expect(await service.remove(created.id)).toBe(true);
    expect(await service.get(created.id)).toBeNull();
  });

  it("returns null/false for missing documents", async () => {
    expect(await service.update("missing", { title: "x" })).toBeNull();
    expect(await service.remove("missing")).toBe(false);
  });

  it("falls back to the default title when cleared", async () => {
    const doc = await service.create({ title: "Draft" });
    expect((await service.update(doc.id, { title: "" }))?.title).toBe("Untitled document");
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
