// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "@/lib/editor/extensions";
import { metricsBlocks } from "@/lib/editor/locate";
import {
  Suggestions,
  applySuggestion,
  dismissSuggestion,
  setExternalMatches,
  type Suggestion,
} from "@/lib/editor/suggestions";
import { collectTextBlocks, withoutFootnotes } from "@/lib/editor/textblocks";
import type { RuleMatch } from "@/lib/rules/types";
import { computeMetrics } from "@/lib/text/metrics";

const fn = (id: string, content: string) =>
  `<sup data-footnote data-id="${id}" data-content="${content}"></sup>`;

function makeEditor(html: string) {
  let latest: Suggestion[] = [];
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...documentExtensions(), Suggestions.configure({ onChange: (s) => (latest = s) })],
    content: html,
  });
  const flaggedText = () => latest.map((s) => editor.state.doc.textBetween(s.from, s.to));
  return { editor, suggestions: () => latest, flaggedText };
}

const contractions = (s: Suggestion[]) => s.filter((x) => x.ruleId === "contractions");

describe("identical paragraphs", () => {
  it("give their suggestions different keys, so each card acts on its own paragraph", () => {
    const { editor, suggestions } = makeEditor("<p>We don't know.</p><p>We don't know.</p>");
    const [first, second] = contractions(suggestions());
    expect(first!.key).not.toBe(second!.key);
    applySuggestion(editor.view, second!, "do not");
    expect(editor.getText({ blockSeparator: "\n" })).toBe("We don't know.\nWe do not know.");
    editor.destroy();
  });
});

describe("dismissing a suggestion", () => {
  it("hides that one only, not the same words elsewhere", () => {
    const { editor, suggestions, flaggedText } = makeEditor(
      "<p>We don't know.</p><p>They don't agree, and we don't either.</p>",
    );
    expect(contractions(suggestions())).toHaveLength(3);
    dismissSuggestion(editor.view, contractions(suggestions())[1]!.key);
    const left = contractions(suggestions());
    expect(left).toHaveLength(2);
    expect(left.map((s) => s.blockText)).toEqual([
      "We don't know.",
      "They don't agree, and we don't either.",
    ]);
    expect(left[1]!.start).toBe("They don't agree, and we ".length);
    expect(flaggedText()).toContain("don't");
    editor.destroy();
  });

  it("follows its words through edits before and after them", () => {
    const { editor, suggestions } = makeEditor("<p>We don't know.</p>");
    dismissSuggestion(editor.view, contractions(suggestions())[0]!.key);
    expect(contractions(suggestions())).toHaveLength(0);
    // Typing right before the words, right after them, and in a new paragraph above.
    editor.commands.insertContentAt(1, "Still, ");
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Yet.");
    editor.commands.insertContentAt(0, "<p>Intro.</p>");
    expect(editor.getText({ blockSeparator: "\n" })).toBe("Intro.\nStill, We don't know. Yet.");
    expect(contractions(suggestions())).toHaveLength(0);
    editor.destroy();
  });

  it("is forgotten once its words are deleted, so retyping them is flagged again", () => {
    const { editor, suggestions } = makeEditor("<p>We don't know.</p>");
    const [s] = contractions(suggestions());
    dismissSuggestion(editor.view, s!.key);
    editor.commands.deleteRange({ from: s!.from, to: s!.to });
    editor.commands.insertContentAt(s!.from, "can't");
    expect(contractions(suggestions()).map((x) => x.flagged)).toEqual(["can't"]);
    editor.destroy();
  });
});

describe("code", () => {
  it("gets no suggestions in a code block", () => {
    const { editor, suggestions } = makeEditor(
      "<pre><code>don't  the the very</code></pre><p>We don't know.</p>",
    );
    expect(suggestions().map((s) => s.blockText)).toEqual(["We don't know."]);
    editor.destroy();
  });

  it("gets no suggestions in inline code, but the prose around it does", () => {
    const { editor, flaggedText } = makeEditor(
      "<p>Call <code>can't_fail()</code> and we don't know.</p>",
    );
    expect(flaggedText()).toEqual(["don't"]);
    editor.destroy();
  });

  it("drops AI matches in inline code too", () => {
    const { editor, suggestions } = makeEditor(
      "<p>Run <code>this_thing</code> here: it is fast.</p>",
    );
    const block = collectTextBlocks(editor.state.doc)[0]!;
    const sent = withoutFootnotes(block).text;
    const at = (quote: string): RuleMatch => ({
      ruleId: "ai",
      category: "clarity",
      start: sent.indexOf(quote),
      end: sent.indexOf(quote) + quote.length,
      message: "m",
      explanation: "e",
      replacements: [],
    });
    setExternalMatches(editor.view, new Map([[sent, [at("this_thing"), at("fast")]]]));
    expect(suggestions().map((s) => s.flagged)).toEqual(["fast"]);
    editor.destroy();
  });

  it("is not prose for the Overview: no sentences, but its words count", () => {
    const { editor } = makeEditor(
      "<p>One short sentence here.</p><pre><code>const x = 1; const y = 2;</code></pre>",
    );
    const metrics = computeMetrics(metricsBlocks(editor.state.doc));
    expect(metrics.paragraphs).toBe(1);
    expect(metrics.sentences).toBe(1);
    expect(metrics.words).toBeGreaterThan(metrics.proseWords);
    editor.destroy();
  });
});

describe("what a card shows", () => {
  it("leaves footnote markers out and shows a line break as a space", () => {
    const sentence = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const html = `<p>${sentence.replace("word10", `word10${fn("a", "Note")}`).replace("word20 ", "word20<br>")}.</p>`;
    const { editor, suggestions } = makeEditor(html);
    const long = suggestions().find((s) => s.ruleId === "long-sentence");
    expect(long).toBeDefined();
    expect(long!.flagged).not.toContain("￼");
    expect(long!.flagged).toContain("word10 word11");
    expect(long!.flagged).toContain("word20 word21");
    editor.destroy();
  });
});

describe("AI suggestions next to footnotes", () => {
  it("keeps a suggestion to rephrase that spans a marker, and drops a fix that would delete it", () => {
    const { editor, suggestions } = makeEditor(
      `<p>The results were clear${fn("a", "Smith 2020")} and strong.</p>`,
    );
    const sent = withoutFootnotes(collectTextBlocks(editor.state.doc)[0]!).text;
    const span = (quote: string, replacements: string[]): RuleMatch => ({
      ruleId: "ai",
      category: "clarity",
      start: sent.indexOf(quote),
      end: sent.indexOf(quote) + quote.length,
      message: replacements.length ? "Fix" : "Rephrase",
      explanation: "e",
      replacements,
    });
    setExternalMatches(editor.view, new Map([[sent, [span("clear and strong", [])]]]));
    expect(suggestions().map((s) => s.message)).toEqual(["Rephrase"]);
    setExternalMatches(editor.view, new Map([[sent, [span("clear and", ["clear,"])]]]));
    expect(suggestions()).toEqual([]);
    editor.destroy();
  });
});
