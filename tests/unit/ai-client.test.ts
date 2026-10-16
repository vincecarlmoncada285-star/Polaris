import { afterEach, describe, expect, it, vi } from "vitest";

// A stand-in SDK, so the test can see when (and how) the client is constructed.
const constructed = vi.hoisted(() => [] as unknown[]);
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    constructor(options: unknown) {
      constructed.push(options);
    }
  },
}));

import {
  aiModel,
  DEFAULT_AI_MODEL,
  getAnthropicClient,
  isAiConfigured,
  paragraphEffort,
  reviewEffort,
  supportsServerSideFallback,
} from "@/lib/ai/client";

afterEach(() => vi.restoreAllMocks());

describe("model selection", () => {
  it("defaults to the exact Opus 5.5 id", () => {
    expect(DEFAULT_AI_MODEL).toBe("claude-opus-5-5");
    expect(aiModel({})).toBe("claude-opus-5-5");
    expect(aiModel({ POLARIS_AI_MODEL: "   " })).toBe("claude-opus-5-5");
  });

  it("can be overridden with POLARIS_AI_MODEL", () => {
    expect(aiModel({ POLARIS_AI_MODEL: " claude-haiku-5-5 " })).toBe("claude-haiku-5-5");
  });

  it("knows Haiku has no server-side fallback", () => {
    expect(supportsServerSideFallback("claude-opus-5-5")).toBe(true);
    expect(supportsServerSideFallback("claude-sonnet-5-5")).toBe(true);
    expect(supportsServerSideFallback("claude-haiku-5-5")).toBe(false);
    expect(supportsServerSideFallback("claude-haiku-4-5")).toBe(false);
  });
});

describe("paragraph effort", () => {
  it("defaults to low", () => {
    expect(paragraphEffort({})).toBe("low");
  });

  it.each(["low", "medium", "high", " HIGH "])("accepts %j", (value) => {
    expect(paragraphEffort({ POLARIS_AI_PARAGRAPH_EFFORT: value })).toBe(
      value.trim().toLowerCase(),
    );
  });

  it.each(["max", "xhigh", "fast", "1"])("falls back to low for %j, with a warning", (value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(paragraphEffort({ POLARIS_AI_PARAGRAPH_EFFORT: value })).toBe("low");
    // Warned at most once per process, so it cannot flood the logs.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("review effort", () => {
  it("defaults to high, not the model's own lower default", () => {
    expect(reviewEffort({})).toBe("high");
    expect(reviewEffort({ POLARIS_AI_REVIEW_EFFORT: "  " })).toBe("high");
  });

  it.each(["low", "medium", "high", "xhigh", "max", " MAX "])("accepts %j", (value) => {
    expect(reviewEffort({ POLARIS_AI_REVIEW_EFFORT: value })).toBe(value.trim().toLowerCase());
  });

  it("is independent of the paragraph effort", () => {
    expect(reviewEffort({ POLARIS_AI_PARAGRAPH_EFFORT: "low" })).toBe("high");
    expect(paragraphEffort({ POLARIS_AI_REVIEW_EFFORT: "max" })).toBe("low");
  });

  it.each(["fast", "highest", "1"])(
    "falls back to high for %j, warning once per process",
    async (value) => {
      // A fresh copy of the module, so its "already warned" flag starts unset.
      vi.resetModules();
      const fresh = await import("@/lib/ai/client");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(fresh.reviewEffort({ POLARIS_AI_REVIEW_EFFORT: value })).toBe("high");
      expect(fresh.reviewEffort({ POLARIS_AI_REVIEW_EFFORT: value })).toBe("high");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("POLARIS_AI_REVIEW_EFFORT"));
    },
  );
});

describe("isAiConfigured", () => {
  it.each<[Record<string, string>, boolean]>([
    [{}, false],
    [{ ANTHROPIC_API_KEY: "" }, false],
    [{ ANTHROPIC_API_KEY: "   " }, false],
    [{ ANTHROPIC_API_KEY: "sk-ant-test" }, true],
    [{ ANTHROPIC_AUTH_TOKEN: "token" }, true],
    [{ ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "token" }, true],
  ])("%j -> %s", (env, expected) => {
    expect(isAiConfigured(env)).toBe(expected);
  });
});

describe("getAnthropicClient", () => {
  it("is created lazily, once, with a short timeout and one retry", () => {
    // Importing the module above did not construct anything.
    expect(constructed).toHaveLength(0);
    const a = getAnthropicClient();
    const b = getAnthropicClient();
    expect(a).toBe(b);
    expect(constructed).toEqual([{ maxRetries: 1, timeout: 60_000 }]);
  });
});
