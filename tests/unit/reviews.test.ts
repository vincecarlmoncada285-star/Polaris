import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReviewLimits } from "@/lib/ai/limits";
import type { ReviewResult } from "@/lib/ai/protocol";
import {
  blocksFromContent,
  blocksFromPlainText,
  blocksText,
  isNumberedParagraph,
  reviewBlocks,
} from "@/lib/documents/blocks";
import {
  contentHash,
  createReviewService,
  MAX_REVIEWS_PER_DOCUMENT,
} from "@/lib/documents/reviews";
import { createDocumentService } from "@/lib/documents/service";
import { createTestDb } from "./test-db";

const result = (summary: string): ReviewResult => ({
  summary,
  thesis: { assessment: "Clear.", quote: null },
  strengths: [],
  priorities: [],
  sections: [],
  structure: "",
  argument: "",
  evidence: "",
  style: "",
});

describe("review service", () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;
  let reviews: ReturnType<typeof createReviewService>;
  let docs: ReturnType<typeof createDocumentService>;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    ({ db, cleanup } = createTestDb());
    reviews = createReviewService(db);
    docs = createDocumentService(db);
    alice = (await db.user.create({ data: { email: "a@example.com", passwordHash: "x" } })).id;
    bob = (await db.user.create({ data: { email: "b@example.com", passwordHash: "x" } })).id;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  });

  const save = (userId: string, documentId: string, summary: string) =>
    reviews.save(userId, documentId, {
      model: "claude-opus-5-5",
      promptVersion: "review-test",
      wordCount: 200,
      contentHash: contentHash([{ text: "text", heading: null }]),
      result: result(summary),
    });

  it("saves a review and reads back the latest", async () => {
    const doc = await docs.create(alice);
    expect(await reviews.latest(alice, doc.id)).toBeNull();
    const first = await save(alice, doc.id, "First.");
    await new Promise((r) => setTimeout(r, 5));
    const second = await save(alice, doc.id, "Second.");
    expect(first).toMatchObject({ documentId: doc.id, model: "claude-opus-5-5", wordCount: 200 });
    const latest = await reviews.latest(alice, doc.id);
    expect(latest?.id).toBe(second!.id);
    expect(latest?.result.summary).toBe("Second.");
  });

  it(`keeps only the ${MAX_REVIEWS_PER_DOCUMENT} newest reviews of a document`, async () => {
    const doc = await docs.create(alice);
    const other = await docs.create(alice);
    await save(alice, other.id, "Other document.");
    const saved: string[] = [];
    for (let i = 0; i < 8; i++) saved.push((await save(alice, doc.id, `Review ${i}.`))!.id);
    expect(await reviews.count(alice, doc.id)).toBe(MAX_REVIEWS_PER_DOCUMENT);
    const kept = await db.documentReview.findMany({
      where: { documentId: doc.id },
      select: { id: true },
    });
    expect(kept.map((r) => r.id).sort()).toEqual(saved.slice(-5).sort());
    expect((await reviews.latest(alice, doc.id))?.result.summary).toBe("Review 7.");
    // Another document's reviews are untouched.
    expect(await reviews.count(alice, other.id)).toBe(1);
  });

  it("will not save or read a review of another user's document", async () => {
    const doc = await docs.create(alice);
    await save(alice, doc.id, "Mine.");
    expect(await save(bob, doc.id, "Not mine.")).toBeNull();
    expect(await reviews.latest(bob, doc.id)).toBeNull();
    expect(await reviews.count(alice, doc.id)).toBe(1);
  });

  it("deletes a document's reviews with the document", async () => {
    const doc = await docs.create(alice);
    await save(alice, doc.id, "Gone soon.");
    await docs.remove(alice, doc.id);
    expect(await db.documentReview.count({ where: { documentId: doc.id } })).toBe(0);
  });
});

describe("contentHash", () => {
  const p = (text: string) => ({ text, heading: null });

  it("is a sha256 of the blocks' text, and changes with any edit", () => {
    expect(contentHash([p("Draft.")])).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash([p("Draft.")])).toBe(contentHash([p("Draft.")]));
    expect(contentHash([p("Draft.")])).not.toBe(contentHash([p("Draft. ")]));
    // Where the blocks break matters, not just their characters.
    expect(contentHash([p("One"), p("two")])).not.toBe(contentHash([p("One two")]));
    expect(contentHash([p("ab"), p("c")])).not.toBe(contentHash([p("a"), p("bc")]));
  });

  it("changes when a paragraph becomes a heading, which renumbers the paragraphs", () => {
    const blocks = [p("Introduction"), p("Homework helps.")];
    const withHeading = [{ text: "Introduction", heading: 2 }, p("Homework helps.")];
    expect(contentHash(withHeading)).not.toBe(contentHash(blocks));
    expect(contentHash(withHeading)).not.toBe(
      contentHash([{ text: "Introduction", heading: 3 }, p("Homework helps.")]),
    );
  });
});

describe("blocksFromContent", () => {
  it("lists textblocks in order, with heading levels and hard breaks as line breaks", () => {
    const content = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Intro" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "One " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "two." },
          ],
        },
        { type: "paragraph" },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Item." }] }],
            },
          ],
        },
        { type: "horizontalRule" },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted." }] }],
        },
      ],
    };
    expect(blocksFromContent(content)).toEqual([
      { text: "Intro", heading: 2 },
      { text: "One bold\ntwo.", heading: null },
      { text: "", heading: null },
      { text: "Item.", heading: null },
      { text: "Quoted.", heading: null },
    ]);
  });

  it.each([null, "text", { type: "paragraph" }, 42])("returns null for %j", (content) => {
    expect(blocksFromContent(content)).toBeNull();
  });

  it("falls back to blank-line paragraphs for plain text", () => {
    expect(blocksFromPlainText("One.\n\nTwo\nlines.")).toEqual([
      { text: "One.", heading: null },
      { text: "Two\nlines.", heading: null },
    ]);
  });

  it("reads a review's blocks from the JSON, from the plain text only without JSON", () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "From the JSON." }] }],
    };
    expect(reviewBlocks({ content, plainText: "Something else." })).toEqual([
      { text: "From the JSON.", heading: null },
    ]);
    const blocks = reviewBlocks({ content: null, plainText: "One.\n\nTwo." });
    expect(blocks).toEqual([
      { text: "One.", heading: null },
      { text: "Two.", heading: null },
    ]);
    expect(blocksText(blocks)).toBe("One.\n\nTwo.");
  });

  it("numbers only paragraphs with text", () => {
    expect(isNumberedParagraph({ text: "Text.", heading: null })).toBe(true);
    expect(isNumberedParagraph({ text: "  ", heading: null })).toBe(false);
    expect(isNumberedParagraph({ text: "\uFFFC", heading: null })).toBe(false);
    expect(isNumberedParagraph({ text: "Heading", heading: 1 })).toBe(false);
  });
});

describe("review rate limits", () => {
  it("allows 6 reviews an hour per user, then says when to try again", () => {
    let t = 0;
    const limits = createReviewLimits(() => t);
    for (let i = 0; i < 6; i++) expect(limits.check("u").ok).toBe(true);
    const refused = limits.check("u");
    expect(refused).toEqual({ ok: false, retryAfterMs: 60 * 60_000, scope: "user" });
    expect(limits.check("someone else").ok).toBe(true);
    t = 60 * 60_000 + 1;
    expect(limits.check("u").ok).toBe(true);
  });

  it("allows 30 a day", () => {
    let t = 0;
    const limits = createReviewLimits(() => t);
    for (let i = 0; i < 30; i++) {
      expect(limits.check("u").ok).toBe(true);
      t += 10 * 60_000; // one every 10 minutes never meets the hourly limit
    }
    // 300 minutes in: the first review leaves the day's window at 1,440 minutes.
    expect(limits.check("u")).toEqual({
      ok: false,
      retryAfterMs: (1440 - 300) * 60_000,
      scope: "user",
    });
  });
});
