import { inspect } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// The route's collaborators: the session, the users service and the Anthropic client module.
// Nothing here talks to a database or the network.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/users", () => ({ users: { getUser: vi.fn() } }));
vi.mock("@/auth", () => ({ signOut: vi.fn() }));
const parse = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    isAiConfigured: vi.fn(() => true),
    getAnthropicClient: vi.fn(() => ({ beta: { messages: { parse } } })),
  };
});

import { POST } from "@/app/api/ai/paragraph/route";
import { GET as getMe } from "@/app/api/me/route";
import { paragraphFeedbackCache } from "@/lib/ai/cache";
import { isAiConfigured } from "@/lib/ai/client";
import { aiLimits } from "@/lib/ai/limits";
import { AiOutputError } from "@/lib/ai/paragraph";
import type { ParagraphResponse } from "@/lib/ai/protocol";
import { requireUser } from "@/lib/auth/session";
import { users } from "@/lib/users";

const USER = "user-1";
const TEXT = "Our survey of nine students proves that homework always harms learning.";
// Distinctive model output, to check it never reaches the logs either.
const EXPLANATION = "Nine students cannot show what is true of every student, zebra-quokka.";

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;
let spies: MockInstance[] = [];

function user(aiEnabled = true) {
  return {
    id: USER,
    email: "a@example.com",
    name: null,
    aiEnabled,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function feedback(stop_reason = "end_turn") {
  return {
    stop_reason,
    content: [],
    parsed_output: {
      suggestions: [
        {
          quote: "proves",
          occurrence: null,
          category: "clarity",
          message: "Claim is stronger than the evidence",
          explanation: EXPLANATION,
          replacement: "suggests",
        },
      ],
    },
  };
}

function request(body: unknown, init: RequestInit = {}) {
  return new Request("http://localhost/api/ai/paragraph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

const body = (overrides: Record<string, unknown> = {}) => ({
  text: TEXT,
  goals: { citationStyle: "apa" },
  ...overrides,
});

function logged(): string {
  return (
    spies
      .flatMap((spy) => spy.mock.calls)
      // inspect, not JSON.stringify: it includes an Error's message and stack.
      .map((args) =>
        args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 }))).join(" "),
      )
      .join("\n")
  );
}

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue(USER);
  vi.mocked(users.getUser).mockResolvedValue(user());
  vi.mocked(isAiConfigured).mockReturnValue(true);
  parse.mockReset();
  parse.mockResolvedValue(feedback());
  paragraphFeedbackCache.clear();
  aiLimits.reset();
  spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  // Whatever the outcome, the paragraph and the model's output never reach a log.
  const text = logged();
  expect(text).not.toContain("homework");
  expect(text).not.toContain("zebra-quokka");
  vi.restoreAllMocks();
});

describe("POST /api/ai/paragraph: access", () => {
  it("returns 401 when signed out, before reading anything", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(request(body()));
    expect(res.status).toBe(401);
    expect(users.getUser).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns 401 when the session's account no longer exists", async () => {
    vi.mocked(users.getUser).mockResolvedValue(null);
    expect((await POST(request(body()))).status).toBe(401);
  });

  it("returns 403 ai_disabled unless the user's setting (read from the database) is on", async () => {
    vi.mocked(users.getUser).mockResolvedValue(user(false));
    const res = await POST(request(body()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ai_disabled" });
    expect(users.getUser).toHaveBeenCalledWith(USER);
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns 503 ai_unavailable when the server has no Anthropic credentials", async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);
    const res = await POST(request(body()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "ai_unavailable" });
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/paragraph: validation", () => {
  it.each<[string, unknown]>([
    ["invalid JSON", "{not json"],
    ["a missing text", { goals: {} }],
    ["missing goals", { text: TEXT }],
    ["blank text", body({ text: "   \n" })],
    ["an unknown goal value", body({ goals: { citationStyle: "harvard" } })],
    ["an unknown field", body({ model: "claude-haiku-5-5" })],
    ["a non-string title", body({ title: 42 })],
  ])("returns 400 for %s", async (_label, payload) => {
    const res = await POST(request(payload));
    expect(res.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ["text over 4000 characters", body({ text: "a ".repeat(2000) + "b" })],
    ["a previous paragraph over 4000 characters", body({ previous: "p".repeat(4001) })],
    ["a title over 200 characters", body({ title: "t".repeat(201) })],
  ])("returns 413 for %s", async (_label, payload) => {
    const res = await POST(request(payload));
    expect(res.status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it("accepts exactly 4000 characters", async () => {
    const text = `${"word ".repeat(799)}last.`;
    expect(text).toHaveLength(4000);
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      content: [],
      parsed_output: { suggestions: [] },
    });
    expect((await POST(request(body({ text })))).status).toBe(200);
  });

  it("returns 413 for an oversized body without parsing it", async () => {
    const res = await POST(request(`{"text":"${"x".repeat(50_000)}"}`));
    expect(res.status).toBe(413);
  });
});

describe("POST /api/ai/paragraph: answers", () => {
  it("returns suggestions anchored to offsets in the paragraph", async () => {
    const res = await POST(request(body()));
    expect(res.status).toBe(200);
    const data = (await res.json()) as ParagraphResponse;
    const start = TEXT.indexOf("proves");
    expect(data).toEqual({
      suggestions: [
        {
          start,
          end: start + "proves".length,
          category: "clarity",
          message: "Claim is stronger than the evidence",
          explanation: EXPLANATION,
          replacements: ["suggests"],
        },
      ],
      cached: false,
    });
    expect(data).not.toHaveProperty("refused");
  });

  it("sends the paragraph, goals and context to Claude, with the request's abort signal", async () => {
    const controller = new AbortController();
    const req = request(body({ title: " Homework ", previous: "Earlier paragraph." }), {
      signal: controller.signal,
    });
    await POST(req);
    const [params, options] = parse.mock.calls[0]!;
    const content = params.messages[0].content as string;
    expect(content).toContain(`<paragraph>\n${TEXT}\n</paragraph>`);
    expect(content).toContain("<document_title>\nHomework\n</document_title>");
    expect(content).toContain("<previous_paragraph>\nEarlier paragraph.\n</previous_paragraph>");
    expect(content).toContain("Citation style: APA (7th)");
    expect(options.signal).toBe(req.signal);
    // A client abort reaches the SDK call.
    controller.abort();
    expect(options.signal.aborted).toBe(true);
  });

  it("serves a second identical request from the cache without calling Claude", async () => {
    const first = (await (await POST(request(body()))).json()) as ParagraphResponse;
    const second = (await (await POST(request(body()))).json()) as ParagraphResponse;
    expect(parse).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.suggestions).toEqual(first.suggestions);
  });

  it("misses the cache when the goals or the text differ", async () => {
    await POST(request(body()));
    await POST(request(body({ goals: { citationStyle: "mla" } })));
    await POST(request(body({ text: `${TEXT} More.` })));
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("does not count cache hits against the rate limit", async () => {
    await POST(request(body()));
    for (let i = 0; i < 40; i++) expect((await POST(request(body()))).status).toBe(200);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal as no suggestions, and caches it", async () => {
    parse.mockResolvedValue({ stop_reason: "refusal", content: [], parsed_output: null });
    const res = await POST(request(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [], refused: true, cached: false });
    expect(await (await POST(request(body()))).json()).toEqual({
      suggestions: [],
      refused: true,
      cached: true,
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ai/paragraph: rate limits", () => {
  it("allows 30 a minute per user, then 429 with Retry-After, without calling Claude", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await POST(request(body({ text: `${TEXT} (${i})` })))).status).toBe(200);
    }
    const res = await POST(request(body({ text: `${TEXT} (30)` })));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(parse).toHaveBeenCalledTimes(30);

    // Another writer is unaffected.
    vi.mocked(requireUser).mockResolvedValue("user-2");
    vi.mocked(users.getUser).mockResolvedValue({ ...user(), id: "user-2" });
    expect((await POST(request(body({ text: `${TEXT} (31)` })))).status).toBe(200);
  });

  it("enforces the daily limit too", async () => {
    for (let i = 0; i < 600; i++) aiLimits.perDay.hit(USER);
    const res = await POST(request(body()));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(60 * 60);
  });
});

describe("POST /api/ai/paragraph: upstream errors", () => {
  const headers = () => new Headers({ "request-id": "req_0123", "retry-after": "12" });

  it("maps an Anthropic rate limit to 429 with its Retry-After, and does not cache it", async () => {
    parse.mockRejectedValueOnce(
      new Anthropic.RateLimitError(429, undefined, "rate limited", headers()),
    );
    const res = await POST(request(body()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
    expect((await POST(request(body()))).status).toBe(200);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("maps a connection error to 502", async () => {
    parse.mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "Connection error." }));
    const res = await POST(request(body()));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "ai_error" });
    // Not cached: the next attempt reaches Claude again.
    await POST(request(body()));
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("maps a 5xx to 502 and logs only the class label, status and request id", async () => {
    parse.mockRejectedValueOnce(
      new Anthropic.InternalServerError(500, undefined, `echo: ${TEXT}`, headers()),
    );
    expect((await POST(request(body()))).status).toBe(502);
    expect(logged()).toContain("req_0123");
    expect(logged()).toContain("500");
  });

  it.each([
    [
      "AuthenticationError",
      () => new Anthropic.AuthenticationError(401, undefined, "bad key", headers()),
    ],
    [
      "PermissionDeniedError",
      () => new Anthropic.PermissionDeniedError(403, undefined, "denied", headers()),
    ],
  ])("maps %s to 503 ai_unavailable with a configuration warning", async (_name, make) => {
    parse.mockRejectedValueOnce(make());
    const res = await POST(request(body()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "ai_unavailable" });
    expect(console.warn).toHaveBeenCalledWith(
      "[ai/paragraph]",
      expect.stringContaining("ANTHROPIC_API_KEY"),
      expect.objectContaining({ requestId: "req_0123" }),
    );
  });

  it("maps unusable model output to 502", async () => {
    parse.mockResolvedValueOnce(feedback("max_tokens"));
    expect((await POST(request(body()))).status).toBe(502);
    parse.mockRejectedValueOnce(new AiOutputError("unparseable"));
    expect((await POST(request(body()))).status).toBe(502);
  });

  it("answers a client abort quietly: no body, no log", async () => {
    parse.mockRejectedValueOnce(new Anthropic.APIUserAbortError());
    const res = await POST(request(body()));
    expect(res.status).toBe(499);
    expect(await res.text()).toBe("");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("treats any error after the request was aborted as an abort", async () => {
    const controller = new AbortController();
    parse.mockImplementationOnce(async () => {
      controller.abort();
      throw new Anthropic.APIConnectionError({ message: "socket closed" });
    });
    const res = await POST(request(body(), { signal: controller.signal }));
    expect(res.status).toBe(499);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("GET /api/me", () => {
  it("reports whether AI is configured on this server", async () => {
    vi.mocked(isAiConfigured).mockReturnValue(true);
    expect(await (await getMe()).json()).toMatchObject({ aiEnabled: true, aiConfigured: true });
    vi.mocked(isAiConfigured).mockReturnValue(false);
    expect(await (await getMe()).json()).toMatchObject({ aiConfigured: false });
  });
});
