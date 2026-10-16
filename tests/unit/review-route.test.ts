import { inspect } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// A real database (a fresh SQLite file), so saving, keeping the 5 newest and staleness are
// tested for real. Only the session and the Anthropic client are stand-ins; nothing here
// talks to the network.
const testDb = vi.hoisted(async () => (await import("./test-db")).createTestDb());
vi.mock("@/lib/db", async () => ({ prisma: (await testDb).db }));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
const stream = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    isAiConfigured: vi.fn(() => true),
    getAnthropicClient: vi.fn(() => ({ beta: { messages: { stream } } })),
  };
});

import { GET, POST, maxDuration } from "@/app/api/documents/[id]/review/route";
import { isAiConfigured } from "@/lib/ai/client";
import { reviewLimits } from "@/lib/ai/limits";
import { REVIEW_MAX_CHARS, type ReviewResponse } from "@/lib/ai/protocol";
import { REVIEW_PROMPT_VERSION } from "@/lib/ai/review";
import { AiOutputError } from "@/lib/ai/structured";
import { requireUser } from "@/lib/auth/session";
import { documents } from "@/lib/documents";
import { reviewBlocks } from "@/lib/documents/blocks";
import { contentHash } from "@/lib/documents/reviews";

// Distinctive words in the document and in the model's output, to check they never reach a log.
const SECRET_DOC_WORD = "marmalade-octopus";
const SECRET_MODEL_WORD = "quokka-saxophone";

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
let spies: MockInstance[] = [];
let db: PrismaClient;
let cleanup: () => Promise<void>;
let alice: string;
let bob: string;

/** A paragraph of exactly `words` words, ending in a full stop. */
const words = (n: number, word = "evidence") =>
  `${Array.from({ length: n - 1 }, () => word).join(" ")} end.`;

const P1 = `Homework helps every ${SECRET_DOC_WORD} learn, as nine students told us.`;

/** TipTap JSON: a level-2 "Introduction" heading, then `paragraphs`; or every block a paragraph. */
function contentOf(paragraphs: string[], { heading = true } = {}) {
  return {
    type: "doc",
    content: [
      heading
        ? {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Introduction" }],
          }
        : { type: "paragraph", content: [{ type: "text", text: "Introduction" }] },
      ...paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    ],
  };
}

/** Saves `paragraphs` (after a heading) as the document's content, plain text and title. */
async function writeDocument(userId: string, paragraphs: string[], title = "Homework essay") {
  const doc = await documents.create(userId, { title });
  const plainText = ["Introduction", ...paragraphs].join("\n\n");
  return (await documents.update(userId, doc.id, {
    content: contentOf(paragraphs),
    plainText,
    goals: { documentType: "essay", targetWords: 2000 },
  }))!;
}

const longEnough = () => [P1, words(200)];

function rawReview(overrides: Record<string, unknown> = {}) {
  return {
    summary: `The essay argues that homework helps students. ${SECRET_MODEL_WORD}.`,
    thesis: { assessment: "Clear, but stronger than its evidence.", quote: "Homework helps every" },
    strengths: ["A clear introduction."],
    priorities: [
      {
        title: "Narrow the claim",
        detail: "Nine students cannot speak for every student.",
        quote: "nine students told us",
        category: "evidence",
      },
    ],
    sections: [{ paragraph: 1, heading: "Introduction", note: "State the claim more carefully." }],
    structure: "Logical order.",
    argument: "Overstated.",
    evidence: "Thin.",
    style: "Suitable.",
    ...overrides,
  };
}

/** What finalMessage() resolves to. */
function finalMessage(
  review: unknown = rawReview(),
  stop_reason = "end_turn",
  model = "claude-opus-5-5",
) {
  return { stop_reason, model, content: [{ type: "text", text: JSON.stringify(review) }] };
}

function answerWith(make: () => Promise<unknown>) {
  stream.mockImplementation(() => ({ finalMessage: make }));
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, init: RequestInit = {}) =>
  POST(
    new Request(`http://localhost/api/documents/${id}/review`, { method: "POST", ...init }),
    ctx(id),
  );
const get = (id: string) =>
  GET(new Request(`http://localhost/api/documents/${id}/review`), ctx(id));

function logged(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) =>
      args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 }))).join(" "),
    )
    .join("\n");
}

const reviewCount = (documentId: string) => db.documentReview.count({ where: { documentId } });

beforeAll(async () => {
  ({ db, cleanup } = await testDb);
  alice = (
    await db.user.create({
      data: { email: "alice@example.com", passwordHash: "x", aiEnabled: true },
    })
  ).id;
  bob = (
    await db.user.create({ data: { email: "bob@example.com", passwordHash: "x", aiEnabled: true } })
  ).id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  vi.mocked(requireUser).mockResolvedValue(alice);
  vi.mocked(isAiConfigured).mockReturnValue(true);
  await db.user.update({ where: { id: alice }, data: { aiEnabled: true } });
  stream.mockReset();
  answerWith(async () => finalMessage());
  reviewLimits.reset();
  spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  // Whatever the outcome, the document's text and the model's output never reach a log.
  const text = logged();
  expect(text).not.toContain(SECRET_DOC_WORD);
  expect(text).not.toContain(SECRET_MODEL_WORD);
  expect(text).not.toContain("nine students");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/documents/[id]/review: access", () => {
  it("allows a long run", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 401 when signed out, before reading anything", async () => {
    const doc = await writeDocument(alice, longEnough());
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await post(doc.id)).status).toBe(401);
    expect((await get(doc.id)).status).toBe(401);
    expect(stream).not.toHaveBeenCalled();
  });

  it("returns 404 for another user's document, exactly as for a missing one", async () => {
    const theirs = await writeDocument(bob, longEnough());
    for (const id of [theirs.id, "no-such-document"]) {
      const res = await post(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
      expect((await get(id)).status).toBe(404);
    }
    expect(stream).not.toHaveBeenCalled();
    expect(await reviewCount(theirs.id)).toBe(0);
  });

  it("returns 403 ai_disabled unless the user's setting (read from the database) is on", async () => {
    const doc = await writeDocument(alice, longEnough());
    await db.user.update({ where: { id: alice }, data: { aiEnabled: false } });
    const res = await post(doc.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ai_disabled" });
    expect(stream).not.toHaveBeenCalled();
  });

  it("returns 503 ai_unavailable when the server has no Anthropic credentials", async () => {
    const doc = await writeDocument(alice, longEnough());
    vi.mocked(isAiConfigured).mockReturnValue(false);
    const res = await post(doc.id);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "ai_unavailable" });
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("POST /api/documents/[id]/review: length", () => {
  it("returns 422 too_short under 150 words, and accepts exactly 150", async () => {
    // The heading counts: 1 + 148 = 149 words.
    const short = await writeDocument(alice, [words(148)]);
    const res = await post(short.id);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "too_short",
      error: expect.stringContaining("149"),
    });
    expect(stream).not.toHaveBeenCalled();

    const enough = await writeDocument(alice, [words(149)]);
    expect((await post(enough.id)).status).toBe(201);
  });

  it("returns 413 too_long over 60,000 words, and accepts exactly 60,000", async () => {
    const long = await writeDocument(alice, [words(30_000), words(30_000)]);
    const res = await post(long.id);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "too_long" });
    expect(stream).not.toHaveBeenCalled();

    const limit = await writeDocument(alice, [words(30_000), words(29_999)]);
    expect((await post(limit.id)).status).toBe(201);
  }, 20_000);

  it("measures what would be sent (the stored JSON), not a plain text saved beside it", async () => {
    // A short plain text cannot carry a long document past the limit...
    const doc = await writeDocument(alice, longEnough());
    await documents.update(alice, doc.id, {
      content: contentOf([words(30_000), words(30_001)]),
      plainText: words(200),
    });
    const res = await post(doc.id);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: "too_long",
      error: expect.stringContaining("60,002"),
    });
    // ...and a long plain text does not make a short document long enough.
    await documents.update(alice, doc.id, {
      content: contentOf([words(20)]),
      plainText: words(5_000),
    });
    expect(await (await post(doc.id)).json()).toMatchObject({ code: "too_short" });
    expect(stream).not.toHaveBeenCalled();
  }, 20_000);

  it("returns 413 too_long for a document of few but enormous words", async () => {
    const huge = `${"x".repeat(REVIEW_MAX_CHARS)} ${words(199)}`;
    const doc = await writeDocument(alice, [huge]);
    const res = await post(doc.id);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: "too_long",
      error: expect.stringContaining("characters"),
    });
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("POST /api/documents/[id]/review: success", () => {
  it("reviews the saved document, persists the review and returns it", async () => {
    const doc = await writeDocument(alice, longEnough());
    const res = await post(doc.id);
    expect(res.status).toBe(201);
    const { review } = (await res.json()) as ReviewResponse;
    expect(review).toMatchObject({
      model: "claude-opus-5-5",
      // The heading, P1 (10 words) and the 200-word paragraph.
      wordCount: 211,
      stale: false,
      result: {
        thesis: { quote: "Homework helps every" },
        priorities: [
          { title: "Narrow the claim", quote: "nine students told us", category: "evidence" },
        ],
        sections: [{ paragraph: 1, heading: "Introduction" }],
      },
    });
    expect(Object.keys(review).sort()).toEqual([
      "createdAt",
      "id",
      "model",
      "result",
      "stale",
      "wordCount",
    ]);

    const row = await db.documentReview.findUniqueOrThrow({ where: { id: review.id } });
    expect(row).toMatchObject({
      documentId: doc.id,
      userId: alice,
      promptVersion: REVIEW_PROMPT_VERSION,
      wordCount: doc.wordCount,
      contentHash: contentHash(reviewBlocks(doc)),
    });
    expect(JSON.parse(row.result)).toEqual(review.result);
  });

  it("sends the title, goals and numbered paragraphs, at high effort, with the request's signal", async () => {
    const doc = await writeDocument(alice, longEnough());
    const controller = new AbortController();
    const req = new Request(`http://localhost/api/documents/${doc.id}/review`, {
      method: "POST",
      signal: controller.signal,
    });
    await POST(req, ctx(doc.id));
    const [params, options] = stream.mock.calls[0]!;
    const content = params.messages[0].content as string;
    expect(content).toContain("<document_title>\nHomework essay\n</document_title>");
    expect(content).toContain("Document type: essay");
    expect(content).toContain("Target length: 2,000 words");
    expect(content).toContain(`## Introduction\n\n[P1] ${P1}\n\n[P2] `);
    expect(params.max_tokens).toBe(64000);
    expect(params.output_config.effort).toBe("high");
    expect(options.signal).toBe(req.signal);
  });

  it("uses POLARIS_AI_REVIEW_EFFORT and POLARIS_AI_MODEL", async () => {
    vi.stubEnv("POLARIS_AI_REVIEW_EFFORT", "max");
    vi.stubEnv("POLARIS_AI_MODEL", "claude-haiku-5-5");
    const doc = await writeDocument(alice, longEnough());
    await post(doc.id);
    const [params] = stream.mock.calls[0]!;
    expect(params.output_config.effort).toBe("max");
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params).not.toHaveProperty("fallbacks");
  });

  it("stores the model that answered after a server-side fallback", async () => {
    answerWith(async () => finalMessage(rawReview(), "end_turn", "claude-opus-5"));
    const doc = await writeDocument(alice, longEnough());
    const { review } = (await (await post(doc.id)).json()) as ReviewResponse;
    expect(review.model).toBe("claude-opus-5");
  });

  it("keeps only the 5 newest reviews of a document", async () => {
    const doc = await writeDocument(alice, longEnough());
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      reviewLimits.reset();
      answerWith(async () => finalMessage(rawReview({ summary: `Review number ${i}.` })));
      ids.push(((await (await post(doc.id)).json()) as ReviewResponse).review.id);
    }
    expect(await reviewCount(doc.id)).toBe(5);
    const kept = await db.documentReview.findMany({
      where: { documentId: doc.id },
      select: { id: true },
    });
    expect(kept.map((k) => k.id).sort()).toEqual(ids.slice(2).sort());
    const { review } = (await (await get(doc.id)).json()) as ReviewResponse;
    expect(review.id).toBe(ids[6]);
    expect(review.result.summary).toBe("Review number 6.");
  });
});

describe("GET /api/documents/[id]/review", () => {
  it("returns 404 none before the first review", async () => {
    const doc = await writeDocument(alice, longEnough());
    const res = await get(doc.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "none" });
  });

  it("returns the latest review, stale once the document's text changes", async () => {
    const doc = await writeDocument(alice, longEnough());
    const created = ((await (await post(doc.id)).json()) as ReviewResponse).review;

    const fresh = (await (await get(doc.id)).json()) as ReviewResponse;
    expect(fresh.review).toEqual({ ...created, stale: false });

    // A title or goals change is not a change to what was reviewed.
    await documents.update(alice, doc.id, { title: "Renamed" });
    expect(((await (await get(doc.id)).json()) as ReviewResponse).review.stale).toBe(false);

    const edited = longEnough();
    edited[1] += " One more sentence.";
    await documents.update(alice, doc.id, {
      content: contentOf(edited),
      plainText: ["Introduction", ...edited].join("\n\n"),
    });
    const stale = (await (await get(doc.id)).json()) as ReviewResponse;
    expect(stale.review).toEqual({ ...created, stale: true });

    // Undone: the text is the reviewed text again.
    await documents.update(alice, doc.id, { content: doc.content, plainText: doc.plainText });
    expect(((await (await get(doc.id)).json()) as ReviewResponse).review.stale).toBe(false);
  });

  it("is stale once a paragraph becomes a heading or back, though the plain text is the same", async () => {
    // The review's [P] numbers count paragraphs, not headings: they no longer match.
    const doc = await writeDocument(alice, longEnough());
    await post(doc.id);
    await documents.update(alice, doc.id, {
      content: contentOf(longEnough(), { heading: false }),
      plainText: doc.plainText,
    });
    expect(((await (await get(doc.id)).json()) as ReviewResponse).review.stale).toBe(true);
    await documents.update(alice, doc.id, { content: doc.content });
    expect(((await (await get(doc.id)).json()) as ReviewResponse).review.stale).toBe(false);
  });

  it("is allowed with AI switched off: reading a saved review sends nothing", async () => {
    const doc = await writeDocument(alice, longEnough());
    await post(doc.id);
    await db.user.update({ where: { id: alice }, data: { aiEnabled: false } });
    expect((await get(doc.id)).status).toBe(200);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/documents/[id]/review: rate limits", () => {
  it("allows 6 an hour per user, then 429 with Retry-After, without calling Claude", async () => {
    const doc = await writeDocument(alice, longEnough());
    for (let i = 0; i < 6; i++) expect((await post(doc.id)).status).toBe(201);
    const res = await post(doc.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(3500);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(stream).toHaveBeenCalledTimes(6);

    // Another writer is unaffected.
    vi.mocked(requireUser).mockResolvedValue(bob);
    const theirs = await writeDocument(bob, longEnough());
    expect((await post(theirs.id)).status).toBe(201);
  });

  it("enforces 30 a day", async () => {
    for (let i = 0; i < 30; i++) reviewLimits.perDay.hit(alice);
    const doc = await writeDocument(alice, longEnough());
    const res = await post(doc.id);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(3600);
    expect(stream).not.toHaveBeenCalled();
  });

  it("does not count requests refused before Claude is called", async () => {
    const short = await writeDocument(alice, [words(20)]);
    for (let i = 0; i < 10; i++) expect((await post(short.id)).status).toBe(422);
    const doc = await writeDocument(alice, longEnough());
    expect((await post(doc.id)).status).toBe(201);
  });
});

describe("POST /api/documents/[id]/review: refusals, aborts and upstream errors", () => {
  it("answers a refusal with 422 refused and a kind message, and saves nothing", async () => {
    answerWith(async () => finalMessage(rawReview(), "refusal"));
    const doc = await writeDocument(alice, longEnough());
    const res = await post(doc.id);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("refused");
    expect(body.error).toMatch(/declined/);
    expect(await reviewCount(doc.id)).toBe(0);
  });

  it("answers a client abort quietly and saves nothing", async () => {
    const doc = await writeDocument(alice, longEnough());
    const controller = new AbortController();
    answerWith(async () => {
      controller.abort();
      throw new Anthropic.APIUserAbortError();
    });
    const res = await post(doc.id, { signal: controller.signal });
    expect(res.status).toBe(499);
    expect(await res.text()).toBe("");
    expect(await reviewCount(doc.id)).toBe(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("saves nothing when the request was aborted just as the answer arrived", async () => {
    const doc = await writeDocument(alice, longEnough());
    const controller = new AbortController();
    answerWith(async () => {
      controller.abort();
      return finalMessage();
    });
    const res = await post(doc.id, { signal: controller.signal });
    expect(res.status).toBe(499);
    expect(await reviewCount(doc.id)).toBe(0);
  });

  const headers = () => new Headers({ "request-id": "req_0123", "retry-after": "12" });

  it("maps an Anthropic rate limit to 429 with its Retry-After", async () => {
    answerWith(async () => {
      throw new Anthropic.RateLimitError(429, undefined, "rate limited", headers());
    });
    const doc = await writeDocument(alice, longEnough());
    const res = await post(doc.id);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });

  it.each([
    [
      "AuthenticationError",
      () => new Anthropic.AuthenticationError(401, undefined, "bad key", headers()),
    ],
    [
      "PermissionDeniedError",
      () => new Anthropic.PermissionDeniedError(403, undefined, "no", headers()),
    ],
  ])("maps %s to 503 ai_unavailable with a configuration warning", async (_name, make) => {
    answerWith(async () => {
      throw make();
    });
    const doc = await writeDocument(alice, longEnough());
    const res = await post(doc.id);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "ai_unavailable" });
    expect(console.warn).toHaveBeenCalledWith(
      "[ai/review]",
      expect.stringContaining("ANTHROPIC_API_KEY"),
      expect.objectContaining({ requestId: "req_0123" }),
    );
  });

  it("maps a 5xx that echoes the document to 502, logging only status and request id", async () => {
    answerWith(async () => {
      throw new Anthropic.InternalServerError(500, undefined, `echo: ${P1}`, headers());
    });
    const doc = await writeDocument(alice, longEnough());
    const res = await post(doc.id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "ai_error" });
    expect(logged()).toContain("req_0123");
    expect(logged()).toContain("500");
  });

  it("maps a connection error, a cut-off answer and an unusable one to 502", async () => {
    const doc = await writeDocument(alice, longEnough());
    answerWith(async () => {
      throw new Anthropic.APIConnectionError({ message: "Connection error." });
    });
    expect((await post(doc.id)).status).toBe(502);
    answerWith(async () => finalMessage(rawReview(), "max_tokens"));
    expect((await post(doc.id)).status).toBe(502);
    answerWith(async () => {
      throw new AiOutputError("unparseable");
    });
    expect((await post(doc.id)).status).toBe(502);
    answerWith(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Not JSON." }],
    }));
    expect((await post(doc.id)).status).toBe(502);
    expect(await reviewCount(doc.id)).toBe(0);
  });
});
