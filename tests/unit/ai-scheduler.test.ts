import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParagraphRequest } from "@/lib/ai/protocol";
import type { WritingGoals } from "@/lib/documents/schema";
import {
  createAiScheduler,
  toMatches,
  type AiSchedulerOptions,
  type AiStatus,
} from "@/lib/editor/ai-scheduler";
import type { RuleMatch } from "@/lib/rules/types";

const P1 = "These results prove that the new method works in every case.";
const P2 = "This changed how researchers approach the problem in later studies.";
const P3 = "Several follow-up studies tested the claim with larger and broader samples.";
const P4 = "The authors concluded that further work would be needed before adoption.";
const SEVEN_WORDS = "One two three four five six seven.";
const EIGHT_WORDS = "One two three four five six seven eight.";
const GOALS: WritingGoals = { citationStyle: "apa" };

interface Call {
  body: ParagraphRequest;
  signal: AbortSignal;
  respond: (res: Response) => void;
}

/**
 * A fake server whose responses the test hands out one by one. With `ignoreAbort` it behaves
 * like a response already on its way when the request was cancelled.
 */
function fakeFetch({ ignoreAbort = false } = {}) {
  const calls: Call[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const done = () => void active--;
        if (!ignoreAbort) {
          init.signal?.addEventListener("abort", () => {
            done();
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
        calls.push({
          body: JSON.parse(init.body as string),
          signal: init.signal!,
          respond: (res) => {
            done();
            resolve(res);
          },
        });
      }),
  );
  return { fetch, calls, maxActive: () => maxActive };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const okFor = (text: string, word: string) =>
  json({
    suggestions: [
      {
        start: text.indexOf(word),
        end: text.indexOf(word) + word.length,
        category: "clarity",
        message: "Claim is stronger than the evidence",
        explanation: "A reader may doubt it.",
        replacements: ["suggest"],
      },
    ],
    cached: false,
  });
const empty = () => json({ suggestions: [], cached: false });

function setup(options: Partial<AiSchedulerOptions> = {}, { ignoreAbort = false } = {}) {
  const server = fakeFetch({ ignoreAbort });
  const results: Map<string, RuleMatch[]>[] = [];
  const statuses: AiStatus[] = [];
  const scheduler = createAiScheduler({
    fetch: server.fetch,
    onResults: (m) => results.push(m),
    onStatus: (s) => statuses.push(s),
    ...options,
  });
  const update = (paragraphs: string[], goals: WritingGoals = GOALS, title?: string) =>
    scheduler.update({ paragraphs, goals, title });
  return {
    ...server,
    scheduler,
    update,
    results,
    statuses,
    latest: () => results.at(-1) ?? new Map(),
  };
}

/** Lets resolved fetches and their .json() settle. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("waits until a paragraph has been unchanged for 1500 ms", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1499);
    expect(s.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(s.calls[0]!.body).toEqual({ text: P1, goals: GOALS });
  });

  it("only sends the text the writer stopped at, not every keystroke", async () => {
    const s = setup();
    const words = P1.split(" ");
    for (let n = 8; n <= words.length; n++) {
      s.update([words.slice(0, n).join(" ")]);
      await vi.advanceTimersByTimeAsync(400);
    }
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.calls.map((c) => c.body.text)).toEqual([P1]);
  });

  it("does not restart the wait for a paragraph that did not change", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1000);
    s.update([P1, "Typing a new par"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.calls.map((c) => c.body.text)).toEqual([P1]);
  });
});

describe("which paragraphs", () => {
  it("skips paragraphs under 8 words and sends those with 8", async () => {
    const s = setup();
    s.update([SEVEN_WORDS, EIGHT_WORDS, "", "   "]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.calls.map((c) => c.body.text)).toEqual([EIGHT_WORDS]);
  });

  it("skips paragraphs longer than the server accepts", async () => {
    const s = setup();
    s.update(["word ".repeat(801)]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("sends the previous paragraph and the title as context", async () => {
    const s = setup();
    s.update(["Heading", P1, P2], GOALS, "  My essay ");
    await vi.advanceTimersByTimeAsync(1500);
    const byText = new Map(s.calls.map((c) => [c.body.text, c.body]));
    expect(byText.get(P1)).toEqual({
      text: P1,
      goals: GOALS,
      title: "My essay",
      previous: "Heading",
    });
    expect(byText.get(P2)).toMatchObject({ previous: P1 });
  });

  it("sends no previous paragraph for the first one, or when the one before is blank", async () => {
    const s = setup();
    s.update([P1, "", P2]);
    await vi.advanceTimersByTimeAsync(1500);
    for (const call of s.calls) expect(call.body).not.toHaveProperty("previous");
  });
});

describe("cancellation", () => {
  it("aborts an in-flight request when its paragraph's text changes", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    const first = s.calls[0]!;
    s.update([`${P1} Indeed`]);
    expect(first.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.calls.map((c) => c.body.text)).toEqual([P1, `${P1} Indeed`]);
  });

  it("aborts an in-flight request when the paragraph disappears", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.update([]);
    expect(s.calls[0]!.signal.aborted).toBe(true);
    expect(s.scheduler.status).toEqual({ kind: "idle" });
  });

  it("never shows a result for text that is gone", async () => {
    const s = setup({}, { ignoreAbort: true });
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.update([P2]);
    // A response that arrives after the abort is ignored.
    s.calls[0]!.respond(okFor(P1, "prove"));
    await flush();
    expect(s.results.every((m) => !m.has(P1))).toBe(true);
    // And it did not count as P1 being checked: back to P1 means a fresh request.
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.calls.map((c) => c.body.text)).toEqual([P1, P1]);
  });

  it("drops a paragraph's pending wait when it is deleted before being sent", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1000);
    s.update([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it("stops everything on dispose", async () => {
    const s = setup();
    s.update([P1, P2]);
    await vi.advanceTimersByTimeAsync(1500);
    s.scheduler.dispose();
    expect(s.calls.every((c) => c.signal.aborted)).toBe(true);
    s.update([P3]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("concurrency", () => {
  it("has at most 2 requests in flight and starts the next as one finishes", async () => {
    const s = setup();
    s.update([P1, P2, P3, P4]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(s.scheduler.status).toEqual({ kind: "checking", count: 4 });

    s.calls[0]!.respond(empty());
    await flush();
    expect(s.fetch).toHaveBeenCalledTimes(3);
    expect(s.scheduler.status).toEqual({ kind: "checking", count: 3 });

    for (let i = 1; i < 4; i++) {
      s.calls[i]!.respond(empty());
      await flush();
    }
    expect(s.calls.map((c) => c.body.text)).toEqual([P1, P2, P3, P4]);
    expect(s.maxActive()).toBe(2);
    expect(s.scheduler.status).toEqual({ kind: "idle" });
  });

  it("reports checking, then idle", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(empty());
    await flush();
    expect(s.statuses).toEqual([{ kind: "checking", count: 1 }, { kind: "idle" }]);
  });
});

describe("results and cache", () => {
  it("delivers results keyed by paragraph text, as 'ai' matches", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(okFor(P1, "prove"));
    await flush();
    expect(s.latest().get(P1)).toEqual([
      {
        ruleId: "ai",
        category: "clarity",
        start: P1.indexOf("prove"),
        end: P1.indexOf("prove") + 5,
        message: "Claim is stronger than the evidence",
        explanation: "A reader may doubt it.",
        replacements: ["suggest"],
      },
    ]);
  });

  it("never requests an unchanged paragraph twice, even after edits elsewhere or an undo", async () => {
    const s = setup();
    s.update([P1, P2]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(okFor(P1, "prove"));
    s.calls[1]!.respond(empty());
    await flush();

    // Edit P2 only: only P2's new text is sent.
    s.update([P1, `${P2} Later`]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.calls.map((c) => c.body.text)).toEqual([P1, P2, `${P2} Later`]);
    s.calls[2]!.respond(empty());
    await flush();

    // Undo back to P2: answered from the client cache, at once.
    const before = s.results.length;
    s.update([P1, P2]);
    expect(s.results.length).toBe(before + 1);
    expect([...s.latest().keys()]).toEqual([P1, P2]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not re-emit results when nothing about them changed", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(okFor(P1, "prove"));
    await flush();
    const count = s.results.length;
    s.update([P1, "short"]);
    s.update([P1, "short line"]);
    expect(s.results.length).toBe(count);
  });

  it("treats new goals as new paragraphs", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(okFor(P1, "prove"));
    await flush();
    s.update([P1], { citationStyle: "mla" });
    // Results computed for the old goals are withdrawn straight away.
    expect(s.latest().size).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.calls[1]!.body.goals).toEqual({ citationStyle: "mla" });
  });

  it("keys goals regardless of property order", async () => {
    const s = setup();
    s.update([P1], { audience: "expert", citationStyle: "apa" });
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(empty());
    await flush();
    s.update([P1], { citationStyle: "apa", audience: "expert" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a refusal as an answer with no suggestions", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ suggestions: [], refused: true, cached: false }));
    await flush();
    expect(s.latest().get(P1)).toEqual([]);
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("server refusals and errors", () => {
  it("stops for good after a 403: AI was switched off", async () => {
    const s = setup();
    s.update([P1, P2]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ error: "off", code: "ai_disabled" }, 403));
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "unavailable", reason: "disabled" });
    expect(s.calls[1]!.signal.aborted).toBe(true);
    s.update([P3, P4]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it("withdraws AI results when AI turns out to be off", async () => {
    const s = setup();
    s.update([P1, P2]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(okFor(P1, "prove"));
    await flush();
    expect(s.latest().size).toBe(1);
    s.calls[1]!.respond(json({ error: "off", code: "ai_disabled" }, 403));
    await flush();
    expect(s.latest().size).toBe(0);
  });

  it("stops for good after a 503 ai_unavailable", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ error: "not set up", code: "ai_unavailable" }, 503));
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "unavailable", reason: "not_configured" });
    s.update([P2]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it("stops after a 401", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ error: "Unauthorized" }, 401));
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "unavailable", reason: "signed_out" });
  });

  it("treats a 503 from something else (no ai_unavailable code) as a passing failure", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(new Response("Service Unavailable", { status: 503 }));
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "error", reason: "failed" });
    s.update([P2]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it("backs off after a 429 for as long as Retry-After says, then retries", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(
      json({ error: "slow down", code: "rate_limited" }, 429, { "Retry-After": "10" }),
    );
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "error", reason: "rate_limited" });

    // New paragraphs become due during the backoff, but nothing is sent.
    s.update([P1, P2]);
    await vi.advanceTimersByTimeAsync(8000);
    expect(s.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(s.calls.map((c) => c.body.text)).toEqual([P1, P1, P2]);
    expect(s.scheduler.status).toEqual({ kind: "checking", count: 2 });
  });

  it("backs off for 30 s after a 429 with no usable Retry-After", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ error: "slow down" }, 429, { "Retry-After": "soon" }));
    await flush();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not hammer a paragraph whose request failed, but tries again later", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ error: "upstream" }, 502));
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "error", reason: "failed" });

    s.update([P1]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    s.calls[1]!.respond(empty());
    await flush();
    expect(s.scheduler.status).toEqual({ kind: "idle" });
  });

  it("treats a network failure like a 5xx", async () => {
    const s = setup({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.scheduler.status).toEqual({ kind: "error", reason: "failed" });
  });

  it("never retries a request the server rejected as invalid", async () => {
    const s = setup();
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(1500);
    s.calls[0]!.respond(json({ error: "too long" }, 413));
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    s.update([P1]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("toMatches", () => {
  const good = {
    start: 0,
    end: 5,
    category: "clarity",
    message: "m",
    explanation: "e",
    replacements: [],
  };

  it("keeps well-formed suggestions", () => {
    expect(toMatches("These results", [good])).toHaveLength(1);
  });

  it.each([
    ["an end past the text", { end: 99 }],
    ["an empty range", { end: 0 }],
    ["a negative start", { start: -1 }],
    ["fractional offsets", { end: 2.5 }],
    ["an unknown category", { category: "tone" }],
    ["a non-string replacement", { replacements: [1] }],
    ["a missing message", { message: undefined }],
  ])("drops %s", (_label, change) => {
    expect(toMatches("These results", [{ ...good, ...change }])).toEqual([]);
  });

  it("tolerates a malformed body", () => {
    expect(toMatches("text", undefined)).toEqual([]);
    expect(toMatches("text", [null, "x"])).toEqual([]);
  });
});
