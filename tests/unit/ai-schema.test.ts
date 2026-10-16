import { describe, expect, it } from "vitest";
import {
  cleanFeedback,
  MAX_AI_SUGGESTIONS,
  MAX_EXPLANATION_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_REPLACEMENT_CHARS,
  ParagraphFeedbackSchema,
  truncate,
  type ParagraphFeedback,
} from "@/lib/ai/schema";

type Raw = ParagraphFeedback["suggestions"][number];

function raw(overrides: Partial<Raw> = {}): Raw {
  return {
    quote: "proves",
    occurrence: null,
    category: "clarity",
    message: "Claim is stronger than the evidence",
    explanation: "One study cannot prove a rule.",
    replacement: "suggests",
    ...overrides,
  };
}

const clean = (...suggestions: Raw[]) => cleanFeedback({ suggestions });

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("Short headline", 80)).toBe("Short headline");
    expect(truncate("x".repeat(80), 80)).toBe("x".repeat(80));
  });

  it("cuts at a word boundary near the limit and adds an ellipsis", () => {
    const s = "word ".repeat(30).trim(); // 149 characters
    const out = truncate(s, 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("cuts mid-word when there is no space close to the limit", () => {
    const out = truncate("a".repeat(200), 80);
    expect(out).toBe(`${"a".repeat(79)}…`);
  });
});

describe("cleanFeedback", () => {
  it("trims every field", () => {
    expect(
      clean(
        raw({
          quote: "  proves ",
          message: " Overclaim ",
          explanation: " Why. ",
          replacement: " suggests ",
        }),
      ),
    ).toEqual([
      {
        quote: "proves",
        occurrence: null,
        category: "clarity",
        message: "Overclaim",
        explanation: "Why.",
        replacement: "suggests",
      },
    ]);
  });

  it("truncates the message to 80 and the explanation to 300 characters", () => {
    const [s] = clean(raw({ message: "m ".repeat(100), explanation: "because ".repeat(100) }));
    expect(s!.message.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(s!.explanation.length).toBeLessThanOrEqual(MAX_EXPLANATION_CHARS);
    expect(s!.explanation.endsWith("…")).toBe(true);
  });

  it("never truncates the quote, which has to match the paragraph", () => {
    const quote = "q".repeat(500);
    expect(clean(raw({ quote }))[0]!.quote).toBe(quote);
  });

  it("turns an overlong replacement (a rewrite, not an edit) into 'rephrase'", () => {
    const [s] = clean(raw({ replacement: "r".repeat(MAX_REPLACEMENT_CHARS + 1) }));
    expect(s!.replacement).toBeNull();
    expect(
      clean(raw({ replacement: "r".repeat(MAX_REPLACEMENT_CHARS) }))[0]!.replacement,
    ).toHaveLength(MAX_REPLACEMENT_CHARS);
  });

  it("keeps an empty replacement (a deletion) and a null one (rephrase)", () => {
    expect(clean(raw({ replacement: "" }))[0]!.replacement).toBe("");
    expect(clean(raw({ replacement: null }))[0]!.replacement).toBeNull();
  });

  it.each([
    ["quote", { quote: "   " }],
    ["message", { message: "" }],
    ["explanation", { explanation: " \n " }],
  ])("drops a suggestion with an empty %s", (_field, overrides) => {
    expect(clean(raw(overrides as Partial<Raw>))).toEqual([]);
  });

  it(`keeps at most ${MAX_AI_SUGGESTIONS}, counting only usable ones, in Claude's order`, () => {
    const list = Array.from({ length: 9 }, (_, i) =>
      raw({ quote: `q${i}`, message: i === 1 || i === 3 ? " " : `m${i}` }),
    );
    expect(clean(...list).map((s) => s.quote)).toEqual(["q0", "q2", "q4", "q5", "q6", "q7"]);
  });

  it.each([0, -1, 1.5, Number.NaN])("treats the occurrence %s as unset", (occurrence) => {
    expect(clean(raw({ occurrence }))[0]!.occurrence).toBeNull();
  });

  it("keeps a valid occurrence", () => {
    expect(clean(raw({ occurrence: 2 }))[0]!.occurrence).toBe(2);
  });
});

describe("ParagraphFeedbackSchema", () => {
  it("accepts the documented shape, including nulls", () => {
    expect(
      ParagraphFeedbackSchema.safeParse({
        suggestions: [raw({ occurrence: null, replacement: null })],
      }).success,
    ).toBe(true);
    expect(ParagraphFeedbackSchema.safeParse({ suggestions: [] }).success).toBe(true);
  });

  it("rejects an unknown category and missing fields", () => {
    expect(
      ParagraphFeedbackSchema.safeParse({ suggestions: [raw({ category: "tone" as never })] })
        .success,
    ).toBe(false);
    const missing: Partial<Raw> = raw();
    delete missing.replacement;
    expect(ParagraphFeedbackSchema.safeParse({ suggestions: [missing] }).success).toBe(false);
  });
});
