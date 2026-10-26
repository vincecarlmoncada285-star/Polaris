import { describe, expect, it } from "vitest";
import { splitSentences } from "@/lib/rules/sentences";

const texts = (t: string) => splitSentences(t).map((s) => s.text);

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(texts("One. Two? Three!")).toEqual(["One.", "Two?", "Three!"]);
  });
  it("does not split on academic abbreviations or initials", () => {
    expect(texts("Smith et al. found effects, e.g. in Fig. 2. J. Doe agreed.")).toEqual([
      "Smith et al. found effects, e.g. in Fig. 2.",
      "J. Doe agreed.",
    ]);
  });
  it("keeps decimals and closing quotes", () => {
    expect(texts('The mean was 3.5. He said "no." Then left.')).toEqual([
      "The mean was 3.5.",
      'He said "no."',
      "Then left.",
    ]);
  });
  it("returns offsets that slice back to the sentence", () => {
    const t = "  First.   Second.";
    for (const s of splitSentences(t)) expect(t.slice(s.start, s.end)).toBe(s.text);
  });
});

describe("splitSentences on adversarial punctuation", () => {
  it("is linear on a long run of full stops that no space follows", () => {
    const text = `${".".repeat(200_000)}x and then. A sentence.`;
    const started = performance.now();
    const sentences = splitSentences(text);
    expect(performance.now() - started).toBeLessThan(500);
    expect(sentences.at(-1)!.text).toBe("A sentence.");
  });

  it("still ends a sentence after a run of punctuation and closing quotes", () => {
    expect(splitSentences('He asked "why?!" Then left...').map((s) => s.text)).toEqual([
      'He asked "why?!"',
      "Then left...",
    ]);
  });
});
