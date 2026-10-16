import { describe, expect, it } from "vitest";
import { anchorSuggestions, findQuote } from "@/lib/ai/anchor";
import type { SuggestionDraft } from "@/lib/ai/schema";
import { OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";

const slice = (text: string, range: [number, number] | null) =>
  range ? text.slice(range[0], range[1]) : null;

function draft(overrides: Partial<SuggestionDraft>): SuggestionDraft {
  return {
    quote: "proves",
    occurrence: null,
    category: "clarity",
    message: "Claim is stronger than the evidence",
    explanation: "One study cannot prove a general rule, so a reader may doubt the claim.",
    replacement: "suggests",
    ...overrides,
  };
}

describe("findQuote: exact matches", () => {
  it("finds an exact quote", () => {
    const text = "This study proves that sleep matters.";
    expect(findQuote(text, "proves")).toEqual([11, 17]);
  });

  it("uses UTF-16 offsets, like the editor", () => {
    const text = "😀 This proves it.";
    const range = findQuote(text, "proves");
    expect(range).toEqual([text.indexOf("proves"), text.indexOf("proves") + 6]);
    expect(slice(text, range)).toBe("proves");
  });

  it("takes the first occurrence by default and the n-th when asked", () => {
    const text = "It rose. Then it fell, and it rose again.";
    expect(findQuote(text, "it rose")).toEqual([
      text.indexOf("it rose"),
      text.indexOf("it rose") + 7,
    ]);
    const second = findQuote(text, "rose", 2);
    expect(second![0]).toBe(text.lastIndexOf("rose"));
    expect(findQuote(text, "rose", 1)![0]).toBe(text.indexOf("rose"));
  });

  it("refuses an out-of-range occurrence when the quote is ambiguous", () => {
    expect(findQuote("rose, rose", "rose", 3)).toBeNull();
  });

  it("ignores a wrong occurrence when the quote appears only once", () => {
    const text = "The sample was small.";
    expect(slice(text, findQuote(text, "small", 2))).toBe("small");
  });

  it("counts occurrences without overlap", () => {
    // "aa" appears at 0 and 2 (not at 1), so occurrence 2 is the one at index 2.
    expect(findQuote("aaaa", "aa", 2)).toEqual([2, 4]);
    expect(findQuote("aaaa", "aa", 3)).toBeNull();
  });
});

describe("findQuote: tolerant matches", () => {
  it("matches straight quotes in the quote against curly ones in the text", () => {
    const text = "The author’s “central” claim holds.";
    const range = findQuote(text, `author's "central"`);
    expect(slice(text, range)).toBe("author’s “central”");
  });

  it("matches curly quotes in the quote against straight ones in the text", () => {
    const text = `The author's "central" claim holds.`;
    expect(slice(text, findQuote(text, "author’s “central”"))).toBe(`author's "central"`);
  });

  it("matches across whitespace differences and maps back to the original span", () => {
    const text = "The  effect was\nlarge and lasting.";
    const range = findQuote(text, "effect was large and");
    expect(slice(text, range)).toBe("effect was\nlarge and");
  });

  it("treats an inline atom (hard break) as whitespace", () => {
    const text = `First line${OBJECT_REPLACEMENT}second line`;
    expect(slice(text, findQuote(text, "line\nsecond"))).toBe(`line${OBJECT_REPLACEMENT}second`);
  });

  it("matches dash variants, including a double hyphen for a dash", () => {
    const text = "A well–known result -- one that recurs -- is ignored.";
    expect(slice(text, findQuote(text, "well-known"))).toBe("well–known");
    expect(slice(text, findQuote(text, "result — one"))).toBe("result -- one");
  });

  it("matches an ellipsis character against three dots", () => {
    const text = "They argued that… it failed.";
    expect(slice(text, findQuote(text, "that... it"))).toBe("that… it");
  });

  it("respects the occurrence in a tolerant match", () => {
    const text = "its “key” term and its “key” idea";
    const range = findQuote(text, `"key" idea`);
    expect(slice(text, range)).toBe("“key” idea");
    expect(findQuote(text, `its "key"`, 2)![0]).toBe(text.lastIndexOf("its"));
  });

  it("trims whitespace around the quote", () => {
    expect(slice("We found a gap.", findQuote("We found a gap.", "  a gap "))).toBe("a gap");
  });
});

describe("findQuote: non-matches", () => {
  it.each([
    ["a quote that is not in the text", "The method failed.", "succeeded"],
    ["a paraphrase", "The method failed badly.", "the method was a failure"],
    ["a different case", "The method failed.", "the method"],
    ["an empty quote", "The method failed.", ""],
    ["a whitespace-only quote", "The method failed.", "   "],
    ["a quote longer than the text", "Short.", "Short. And more."],
  ])("returns null for %s", (_label, text, quote) => {
    expect(findQuote(text, quote)).toBeNull();
  });
});

describe("anchorSuggestions", () => {
  const text = "This study proves that sleep matters, and this matters for students.";

  it("anchors a suggestion and carries its fields", () => {
    expect(anchorSuggestions(text, [draft({})])).toEqual([
      {
        start: text.indexOf("proves"),
        end: text.indexOf("proves") + "proves".length,
        category: "clarity",
        message: "Claim is stronger than the evidence",
        explanation: "One study cannot prove a general rule, so a reader may doubt the claim.",
        replacements: ["suggests"],
      },
    ]);
  });

  it("maps a null replacement to no replacements and an empty one to a deletion", () => {
    const [rephrase, remove] = anchorSuggestions(text, [
      draft({ quote: "This study", replacement: null }),
      draft({ quote: " for students", replacement: "" }),
    ]);
    expect(rephrase!.replacements).toEqual([]);
    expect(remove!.replacements).toEqual([""]);
  });

  it("drops a suggestion whose quote cannot be found", () => {
    expect(anchorSuggestions(text, [draft({ quote: "demonstrates" })])).toEqual([]);
  });

  it("drops a suggestion whose replacement equals the quote", () => {
    expect(anchorSuggestions(text, [draft({ replacement: "proves" })])).toEqual([]);
  });

  it("drops a no-op replacement even when the quote matched only after normalizing", () => {
    const curly = "The author’s claim holds.";
    const result = anchorSuggestions(curly, [
      draft({ quote: "author's claim", replacement: "author’s claim" }),
    ]);
    expect(result).toEqual([]);
  });

  it("keeps a replacement that only changes typography the quote matched through", () => {
    // 1990-2000 → 1990–2000 is a real (typographic) correction, not a no-op.
    const range = anchorSuggestions("From 1990-2000 it grew.", [
      draft({ quote: "1990-2000", replacement: "1990–2000", category: "correctness" }),
    ]);
    expect(range).toHaveLength(1);
  });

  it("drops a suggestion that overlaps one kept before it, whatever their positions", () => {
    const result = anchorSuggestions(text, [
      draft({ quote: "sleep matters", replacement: "sleep is important" }),
      draft({ quote: "proves that sleep", replacement: "suggests that sleep" }),
      draft({ quote: "this matters", replacement: null }),
    ]);
    expect(result.map((s) => text.slice(s.start, s.end))).toEqual([
      "sleep matters",
      "this matters",
    ]);
  });

  it("keeps adjacent suggestions that touch but do not overlap", () => {
    const result = anchorSuggestions("ab", [
      draft({ quote: "a", replacement: "x" }),
      draft({ quote: "b", replacement: "y" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("returns suggestions sorted by position", () => {
    const result = anchorSuggestions(text, [
      draft({ quote: "this matters", replacement: null }),
      draft({ quote: "This study", replacement: null }),
    ]);
    expect(result.map((s) => s.start)).toEqual([0, text.indexOf("this matters")]);
  });

  it("uses the occurrence to pick between repeated quotes", () => {
    const result = anchorSuggestions(text, [
      draft({ quote: "matters", occurrence: 2, replacement: null }),
    ]);
    expect(result[0]!.start).toBe(text.lastIndexOf("matters"));
  });
});
