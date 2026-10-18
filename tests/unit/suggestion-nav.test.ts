import { describe, expect, it } from "vitest";
import { adjacentSuggestion, readingOrder } from "@/lib/editor/suggestion-nav";

// Out of order on purpose: the suggestions arrive per paragraph and per rule.
const S = [
  { key: "c", from: 30, to: 35 },
  { key: "a", from: 2, to: 7 },
  { key: "span", from: 2, to: 25 },
  { key: "b", from: 12, to: 16 },
];

const next = (activeKey: string | null, from: number, to = from) =>
  adjacentSuggestion(S, { activeKey, from, to }, 1)?.key;
const previous = (activeKey: string | null, from: number, to = from) =>
  adjacentSuggestion(S, { activeKey, from, to }, -1)?.key;

describe("adjacentSuggestion", () => {
  it("goes in reading order from the open suggestion, wrapping at both ends", () => {
    expect(readingOrder(S).map((s) => s.key)).toEqual(["a", "span", "b", "c"]);
    expect(next("a", 0)).toBe("span");
    expect(next("span", 0)).toBe("b");
    expect(next("c", 0)).toBe("a");
    expect(previous("b", 0)).toBe("span");
    expect(previous("a", 0)).toBe("c");
  });

  it("with none open, starts from the cursor", () => {
    expect(next(null, 0)).toBe("a");
    expect(next(null, 2)).toBe("a"); // at the start of one: that one
    expect(next(null, 8)).toBe("b");
    expect(next(null, 31)).toBe("a"); // past the last: round to the first
    expect(previous(null, 31)).toBe("c");
    expect(previous(null, 12)).toBe("span");
    expect(previous(null, 1)).toBe("c"); // before the first: round to the last
  });

  it("moves on past a selected suggestion (as Escape leaves it) instead of reopening it", () => {
    expect(next(null, 12, 16)).toBe("c");
    expect(previous(null, 12, 16)).toBe("span");
  });

  it("ignores an open key that is no longer there", () => {
    expect(next("gone", 8)).toBe("b");
  });

  it("has nothing to move to without suggestions", () => {
    expect(adjacentSuggestion([], { activeKey: null, from: 0, to: 0 }, 1)).toBeNull();
    expect(adjacentSuggestion([], { activeKey: "a", from: 0, to: 0 }, -1)).toBeNull();
  });

  it("with one suggestion, stays on it", () => {
    const one = [{ key: "x", from: 5, to: 9 }];
    expect(adjacentSuggestion(one, { activeKey: "x", from: 5, to: 9 }, 1)?.key).toBe("x");
    expect(adjacentSuggestion(one, { activeKey: "x", from: 5, to: 9 }, -1)?.key).toBe("x");
  });
});
