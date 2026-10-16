import { describe, expect, it } from "vitest";
import { OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";
import {
  computeMetrics,
  countSyllables,
  fleschKincaidGrade,
  fleschReadingEase,
  lexicalVariety,
  textToBlocks,
} from "@/lib/text/metrics";
import { countWords } from "@/lib/text/stats";

describe("countSyllables", () => {
  // Dictionary syllable counts the heuristic gets right, chosen to exercise each correction.
  it.each<[string, number]>([
    ["the", 1],
    ["cat", 1],
    ["make", 1], // silent final e
    ["while", 1],
    ["table", 2], // consonant + "le" is a syllable
    ["little", 2],
    ["people", 2],
    ["makes", 1], // silent -es
    ["improves", 2],
    ["places", 2], // -es after a sibilant is a syllable
    ["boxes", 2],
    ["changes", 2],
    ["named", 1], // silent -ed
    ["jumped", 1],
    ["talked", 1],
    ["played", 1],
    ["wanted", 2], // -ted is a syllable
    ["debated", 3],
    ["completely", 3], // silent e before a suffix
    ["statement", 2],
    ["useful", 2],
    ["achievement", 3],
    ["media", 3], // "ia" as two syllables
    ["period", 3],
    ["Australian", 4],
    ["nation", 2], // but "-tion", "-cial" as one
    ["special", 2],
    ["education", 4],
    ["university", 5],
    ["beautiful", 3],
    ["analysis", 4],
    ["evidence", 3],
    ["studies", 2],
    ["happy", 2],
    ["year", 1],
    ["queue", 1],
    ["syllable", 3],
    ["It's", 1],
  ])("%s has %i", (word, expected) => {
    expect(countSyllables(word)).toBe(expected);
  });

  it("counts a number or a word in another script as one, and nothing as zero", () => {
    expect(countSyllables("2020")).toBe(1);
    expect(countSyllables("日本")).toBe(1);
    expect(countSyllables("")).toBe(0);
    expect(countSyllables("—")).toBe(0);
  });
});

describe("readability formulas", () => {
  it("match the published formulas on a hand-counted sentence", () => {
    // "The cat sat on the mat.": 6 words, 1 sentence, 6 syllables.
    expect(fleschReadingEase(6, 1, 6)).toBeCloseTo(116.145, 3);
    expect(fleschKincaidGrade(6, 1, 6)).toBeCloseTo(-1.45, 3);
    const m = computeMetrics("The cat sat on the mat.");
    expect(m.fleschReadingEase).toBeCloseTo(116.145, 3);
    expect(m.fleschKincaidGrade).toBeCloseTo(-1.45, 3);
  });

  it("score an everyday passage like a hand count does", () => {
    // Hand count: 26 words, 3 sentences, 32 syllables -> FRE 93.9, FKGL 2.3.
    const m = computeMetrics(
      "The cat sat on the mat. It was a warm and sunny day. The children played in the garden while their parents talked about the weather.",
    );
    expect(m).toMatchObject({ proseWords: 26, sentences: 3 });
    expect(m.syllables).toBe(32);
    expect(m.fleschReadingEase).toBeCloseTo(fleschReadingEase(26, 3, 32), 6);
    expect(m.fleschReadingEase).toBeCloseTo(93.9, 1);
    expect(m.fleschKincaidGrade).toBeCloseTo(2.3, 1);
  });

  it("score an academic passage within a tolerance of the hand count", () => {
    // Hand count (dictionary syllables): 27 words, 2 sentences, 54 syllables, giving
    // FRE 23.9 and FKGL 13.3. The heuristic counts "homework" as 3, so it lands close, not on.
    const m = computeMetrics(
      "Researchers have long debated whether homework improves academic achievement. Several large studies suggest a modest benefit for older students, although the evidence for younger children is weaker.",
    );
    expect(m).toMatchObject({ proseWords: 27, sentences: 2 });
    expect(Math.abs(m.syllables - 54)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.fleschReadingEase! - 23.93)).toBeLessThan(5);
    expect(Math.abs(m.fleschKincaidGrade! - 13.28)).toBeLessThan(1);
    // Academic prose scores as difficult: a low ease, a university grade.
    expect(m.fleschReadingEase!).toBeLessThan(40);
    expect(m.fleschKincaidGrade!).toBeGreaterThan(12);
  });
});

describe("computeMetrics: edge cases", () => {
  it("handles empty text", () => {
    for (const text of ["", "   ", "\n\n\n"]) {
      expect(computeMetrics(text)).toEqual({
        words: 0,
        proseWords: 0,
        sentences: 0,
        paragraphs: 0,
        syllables: 0,
        averageSentenceLength: null,
        sentenceLengthSpread: null,
        longestSentence: null,
        fleschReadingEase: null,
        fleschKincaidGrade: null,
        passiveShare: null,
        lexicalVariety: null,
        repeatedOpeners: [],
        readingMinutes: 0,
      });
    }
    expect(computeMetrics([])).toMatchObject({ words: 0, sentences: 0 });
  });

  it("handles a single word", () => {
    const m = computeMetrics("Hello");
    expect(m).toMatchObject({
      words: 1,
      sentences: 1,
      paragraphs: 1,
      averageSentenceLength: 1,
      sentenceLengthSpread: 0,
      passiveShare: 0,
      lexicalVariety: { value: 1, method: "ttr" },
      repeatedOpeners: [],
      readingMinutes: 1,
      longestSentence: { block: 0, start: 0, end: 5, words: 1, text: "Hello" },
    });
    expect(Number.isFinite(m.fleschReadingEase)).toBe(true);
    expect(Number.isFinite(m.fleschKincaidGrade)).toBe(true);
  });

  it("ignores punctuation-only sentences", () => {
    const m = computeMetrics("One two three. … — !");
    expect(m.sentences).toBe(1);
  });

  it("counts headings as words but not as sentences or paragraphs", () => {
    const m = computeMetrics([
      { text: "Introduction", heading: true },
      { text: "Sleep matters. It helps memory." },
      { text: "" },
      { text: "Methods", heading: true },
      { text: "We asked ten students." },
    ]);
    expect(m.words).toBe(1 + 5 + 1 + 4);
    expect(m.proseWords).toBe(9);
    expect(m.sentences).toBe(3);
    expect(m.paragraphs).toBe(2);
    expect(m.averageSentenceLength).toBe(3);
  });

  it("counts the same words as the footer, hard breaks included", () => {
    const text = `It's a well-known café — 42 times.\n\nSecond${OBJECT_REPLACEMENT}line here.`;
    expect(computeMetrics(text).words).toBe(countWords(text.replace(OBJECT_REPLACEMENT, "\n")));
    expect(computeMetrics(text).words).toBe(9);
  });

  it("treats a hard break as a word boundary", () => {
    expect(computeMetrics(`end${OBJECT_REPLACEMENT}start`).words).toBe(2);
  });
});

describe("computeMetrics: sentences", () => {
  it("averages sentence length and measures its spread", () => {
    // Lengths 2, 4 and 6: mean 4, population standard deviation sqrt(8/3).
    const m = computeMetrics("Two words. Here are four words. And this one has six words.");
    expect(m.averageSentenceLength).toBe(4);
    expect(m.sentenceLengthSpread).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });

  it("finds the longest sentence with offsets into its block", () => {
    const text =
      "Short one.\n\nA middling sentence here. This is by far the longest sentence of them all. Tiny.";
    const blocks = textToBlocks(text);
    const { longestSentence } = computeMetrics(text);
    expect(longestSentence).toMatchObject({ block: 1, words: 10 });
    const { block, start, end } = longestSentence!;
    expect(blocks[block]!.text.slice(start, end)).toBe(
      "This is by far the longest sentence of them all.",
    );
    expect(longestSentence!.text).toBe("This is by far the longest sentence of them all.");
  });

  it("keeps the first of two equally long sentences", () => {
    expect(computeMetrics("One two three. Four five six.").longestSentence).toMatchObject({
      start: 0,
      text: "One two three.",
    });
  });

  it("keeps offsets aligned when the block has hard breaks", () => {
    const blockText = `Line one${OBJECT_REPLACEMENT}continues here with more words. Short.`;
    const { longestSentence } = computeMetrics([{ text: blockText }]);
    expect(blockText.slice(longestSentence!.start, longestSentence!.end)).toBe(
      `Line one${OBJECT_REPLACEMENT}continues here with more words.`,
    );
  });

  it("measures the share of sentences with passive voice", () => {
    const m = computeMetrics(
      "The samples were collected by the team. We analysed them. The results were reviewed. They agreed.",
    );
    expect(m.passiveShare).toBe(0.5);
  });

  it("does not count -ed adjectives after 'be' as passive", () => {
    expect(computeMetrics("She was interested in it. They were tired.").passiveShare).toBe(0);
  });
});

describe("lexical variety", () => {
  it("uses plain TTR under 50 words", () => {
    // 6 tokens, 4 types.
    expect(lexicalVariety(["a", "b", "a", "c", "d", "a"])).toEqual({ value: 4 / 6, method: "ttr" });
    const m = computeMetrics("The cat and the dog and the bird.");
    expect(m.lexicalVariety).toEqual({ value: 5 / 8, method: "ttr" });
  });

  it("uses MATTR from 50 words: the mean TTR of every 50-word window", () => {
    const tokens = Array.from({ length: 120 }, (_, i) => `w${i % 30}`);
    // Brute force, for comparison with the sliding window.
    let sum = 0;
    for (let i = 0; i + 50 <= tokens.length; i++) sum += new Set(tokens.slice(i, i + 50)).size / 50;
    const expected = sum / (tokens.length - 50 + 1);
    const result = lexicalVariety(tokens)!;
    expect(result.method).toBe("mattr");
    expect(result.value).toBeCloseTo(expected, 12);
    // Every window holds all 30 types: 30 / 50.
    expect(result.value).toBeCloseTo(0.6, 12);
  });

  it("does not fall just because a text is longer, unlike TTR", () => {
    // The same 40-word passage, repeated: TTR keeps falling, MATTR stays put.
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`);
    const twice = [...words, ...words];
    const tenTimes = Array.from({ length: 10 }, () => words).flat();
    const ttr = (t: string[]) => new Set(t).size / t.length;
    expect(ttr(tenTimes)).toBeLessThan(ttr(twice) / 4);
    expect(lexicalVariety(tenTimes)!.value).toBeCloseTo(lexicalVariety(twice)!.value, 1);
  });

  it("is 1 when no word repeats within a window, and ignores case and apostrophe style", () => {
    const distinct = Array.from({ length: 60 }, (_, i) => `t${i}`);
    expect(lexicalVariety(distinct)).toEqual({ value: 1, method: "mattr" });
    expect(computeMetrics("It’s it's IT'S.").lexicalVariety).toEqual({
      value: 1 / 3,
      method: "ttr",
    });
  });

  it("treats exactly 50 words as one MATTR window", () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `t${i % 25}`);
    expect(lexicalVariety(tokens)).toEqual({ value: 0.5, method: "mattr" });
  });
});

describe("repeated sentence openers", () => {
  it("lists first words that open 3 or more sentences, most frequent first, top 3", () => {
    const text = [
      "The first. The second. The third. The fourth.",
      "However, one. However, two. However, three.",
      "This is a. This is b. This is c.",
      "It is a. It is b. It is c.",
      "We did. We did again.",
    ].join("\n\n");
    expect(computeMetrics(text).repeatedOpeners).toEqual([
      { word: "The", count: 4 },
      { word: "However", count: 3 },
      { word: "This", count: 3 },
    ]);
  });

  it("matches openers regardless of case, and names them as first written", () => {
    expect(computeMetrics("The a. the b. THE c.").repeatedOpeners).toEqual([
      { word: "The", count: 3 },
    ]);
  });

  it("lists nothing for an opener used only twice, or for headings", () => {
    expect(computeMetrics("We did. We did again. They did.").repeatedOpeners).toEqual([]);
    expect(
      computeMetrics([
        { text: "Results", heading: true },
        { text: "Results", heading: true },
        { text: "Results", heading: true },
      ]).repeatedOpeners,
    ).toEqual([]);
  });
});

describe("reading time and paragraphs", () => {
  it("reads at 200 words a minute", () => {
    expect(computeMetrics("word ".repeat(1000)).readingMinutes).toBe(5);
  });

  it("counts paragraphs separated by blank lines, skipping empty ones", () => {
    expect(computeMetrics("One.\n\nTwo.\n\n\n\nThree.").paragraphs).toBe(3);
  });
});

describe("performance", () => {
  it("computes a 50,000-word document in under 300 ms", () => {
    const vocabulary =
      "students research evidence argument the of and to in that is was were analysed results suggest however although findings method participants significant data were collected by researchers university education approach".split(
        " ",
      );
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const paragraphs: string[] = [];
    let words = 0;
    while (words < 50_000) {
      const sentences: string[] = [];
      for (let s = 0; s < 6 && words < 50_000; s++) {
        const length = 8 + (next() % 25);
        const ws: string[] = [];
        for (let i = 0; i < length && words < 50_000; i++, words++) {
          ws.push(vocabulary[next() % vocabulary.length]!);
        }
        sentences.push(`${ws.join(" ")}.`);
      }
      paragraphs.push(sentences.join(" "));
    }
    const text = paragraphs.join("\n\n");
    computeMetrics(text.slice(0, 2000)); // warm up the JIT, as a real panel would be
    const started = performance.now();
    const m = computeMetrics(text);
    const elapsed = performance.now() - started;
    expect(m.words).toBe(50_000);
    expect(m.lexicalVariety?.method).toBe("mattr");
    expect(elapsed).toBeLessThan(300);
  });
});
