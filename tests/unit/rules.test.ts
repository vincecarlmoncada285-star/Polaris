import { describe, expect, it } from "vitest";
import { checkParagraph, createParagraphChecker } from "@/lib/rules/engine";
import {
  citationFormat,
  contractions,
  informalWords,
  longSentences,
  passiveVoice,
  repeatedWords,
  vagueIntensifiers,
  wordyPhrases,
} from "@/lib/rules/builtin";
import { expandDeletion } from "@/lib/rules/apply";
import type { Rule } from "@/lib/rules/types";

const flagged = (rule: Rule, text: string, ctx = {}) =>
  rule.check(text, ctx).map((m) => ({ text: text.slice(m.start, m.end), fix: m.replacements }));

describe("contractions", () => {
  it("expands common contractions and keeps capitalization", () => {
    expect(flagged(contractions, "It's clear we don't know.")).toEqual([
      { text: "It's", fix: ["It is"] },
      { text: "don't", fix: ["do not"] },
    ]);
  });
  it("handles curly apostrophes", () => {
    expect(flagged(contractions, "They can’t agree.")).toEqual([
      { text: "can’t", fix: ["cannot"] },
    ]);
  });
  it("ignores possessives", () => {
    expect(flagged(contractions, "The author's claim and its scope.")).toEqual([]);
  });
});

describe("vague intensifiers", () => {
  it("flags intensifiers as deletions", () => {
    expect(flagged(vagueIntensifiers, "a very large effect")).toEqual([
      { text: "very", fix: [""] },
    ]);
  });
  it("deletes a capitalised intensifier at the start of a sentence without throwing", () => {
    // matchCase("Very", "") used to read ""[0] and crash the editor on "Very good results."
    expect(flagged(vagueIntensifiers, "Very good results.")).toEqual([{ text: "Very", fix: [""] }]);
    expect(() => checkParagraph("Really, it is Extremely clear.")).not.toThrow();
  });
  it("does not match inside other words", () => {
    expect(flagged(vagueIntensifiers, "superscript every reallocation")).toEqual([]);
  });
});

describe("wordy phrases", () => {
  it("prefers the longest phrase", () => {
    expect(flagged(wordyPhrases, "Due to the fact that it rained")).toEqual([
      { text: "Due to the fact that", fix: ["Because"] },
    ]);
  });
  it("matches across line wrapping whitespace", () => {
    expect(flagged(wordyPhrases, "in  order to")).toEqual([{ text: "in  order to", fix: ["to"] }]);
  });
});

describe("informal words", () => {
  it("flags phrasal verbs", () => {
    expect(flagged(informalWords, "We figure out the cause.")[0]?.text).toBe("figure out");
  });
});

describe("passive voice", () => {
  it("flags be + participle, including irregular ones", () => {
    expect(
      flagged(passiveVoice, "The samples were collected and the data was written up.").map(
        (f) => f.text,
      ),
    ).toEqual(["were collected", "was written"]);
  });
  it("includes an adverb between the verb and participle", () => {
    expect(flagged(passiveVoice, "It was carefully measured.")[0]?.text).toBe(
      "was carefully measured",
    );
  });
  it("skips -ed adjectives unless an agent follows", () => {
    expect(flagged(passiveVoice, "Students were interested in it.")).toEqual([]);
    expect(flagged(passiveVoice, "Results were based on the survey.")).toEqual([]);
  });
});

describe("long sentences", () => {
  it("flags sentences over 40 words, one at a time", () => {
    const long = Array.from({ length: 45 }, () => "word").join(" ") + ".";
    const text = `Short one. ${long} Another short one.`;
    const matches = longSentences.check(text, {});
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe(long);
  });
});

describe("repeated words", () => {
  it("flags doubled words but allows 'had had' and 'that that'", () => {
    expect(flagged(repeatedWords, "the the study")).toEqual([{ text: "the the", fix: ["the"] }]);
    expect(flagged(repeatedWords, "She had had enough; he said that that was fine.")).toEqual([]);
  });

  it("does not take part of a hyphenated or longer word for a repeat", () => {
    expect(flagged(repeatedWords, "We met in in-person sessions.")).toEqual([]);
    expect(flagged(repeatedWords, "After the check-in in May, the drop-in in June.")).toEqual([]);
    expect(flagged(repeatedWords, "the theory and an analysis")).toEqual([]);
    expect(flagged(repeatedWords, "Größe ße")).toEqual([]);
    expect(flagged(repeatedWords, "the student's s s")).toEqual([{ text: "s s", fix: ["s"] }]);
  });

  it("finds repeats of words with accents, in any case", () => {
    expect(flagged(repeatedWords, "C'est très très bien.")).toEqual([
      { text: "très très", fix: ["très"] },
    ]);
    expect(flagged(repeatedWords, "The the study")).toEqual([{ text: "The the", fix: ["The"] }]);
  });
});

describe("citation format", () => {
  it("adds the period to et al", () => {
    expect(flagged(citationFormat, "Smith et al found")).toEqual([
      { text: "et al", fix: ["et al."] },
    ]);
    expect(flagged(citationFormat, "Smith et al. found")).toEqual([]);
  });
  it("APA: adds the comma between author and year", () => {
    expect(flagged(citationFormat, "as shown (Smith 2020).")).toEqual([
      { text: "(Smith 2020)", fix: ["(Smith, 2020)"] },
    ]);
    expect(flagged(citationFormat, "(Smith & Lee 2019b)")[0]?.fix).toEqual([
      "(Smith & Lee, 2019b)",
    ]);
    expect(flagged(citationFormat, "(Smith, 2020)")).toEqual([]);
  });
  it("APA: uses & between two authors in parentheses", () => {
    expect(flagged(citationFormat, "(Smith and Lee, 2020)")[0]?.fix).toEqual([
      "(Smith & Lee, 2020)",
    ]);
  });
  it("MLA: drops the comma before the page", () => {
    expect(flagged(citationFormat, "(Smith, 42)", { citationStyle: "mla" })[0]?.fix).toEqual([
      "(Smith 42)",
    ]);
    expect(flagged(citationFormat, "(Smith 2020)", { citationStyle: "mla" })).toEqual([]);
  });
});

describe("engine", () => {
  it("drops overlapping matches in favour of the higher-priority rule", () => {
    // "really really" is a repeated word and two intensifiers; repetition wins.
    const matches = checkParagraph("It is really really good.");
    expect(matches.map((m) => m.ruleId)).toEqual(["repeated-word"]);
  });
  it("returns matches sorted by position", () => {
    const matches = checkParagraph("We don't use stuff in order to win.");
    expect(matches.map((m) => m.ruleId)).toEqual([
      "contractions",
      "informal-words",
      "wordy-phrases",
    ]);
  });
  it("caches per context", () => {
    let style: "apa" | "mla" = "apa";
    const check = createParagraphChecker(() => ({ citationStyle: style }));
    expect(check("(Smith, 42)")).toHaveLength(0);
    style = "mla";
    expect(check("(Smith, 42)")).toHaveLength(1);
  });
});

describe("expandDeletion", () => {
  it("removes one adjacent space", () => {
    const text = "a very large";
    const [s, e] = expandDeletion(text, 2, 6);
    expect(text.slice(0, s) + text.slice(e)).toBe("a large");
  });
  it("handles words at the start and end", () => {
    let text = "Very good";
    let [s, e] = expandDeletion(text, 0, 4);
    expect(text.slice(0, s) + text.slice(e)).toBe("good");
    text = "good indeed";
    [s, e] = expandDeletion(text, 5, 11);
    expect(text.slice(0, s) + text.slice(e)).toBe("good");
  });
});
