import { describe, expect, it } from "vitest";
import { countCharacters, countWords, readingMinutes } from "@/lib/text/stats";

describe("text stats", () => {
  it("counts words with contractions, hyphens and unicode", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("It's a well-known café — 42 times.")).toBe(6);
  });
  it("counts characters by code point", () => {
    expect(countCharacters("a😀b")).toBe(3);
  });
  it("estimates reading time", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(50)).toBe(1);
    expect(readingMinutes(1000)).toBe(5);
  });
});
