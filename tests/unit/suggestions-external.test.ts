// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  Suggestions,
  applySuggestion,
  dismissSuggestion,
  mergeMatches,
  setExternalMatches,
  type Suggestion,
} from "@/lib/editor/suggestions";
import type { RuleMatch } from "@/lib/rules/types";

function makeEditor(html: string) {
  let latest: Suggestion[] = [];
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, Suggestions.configure({ onChange: (s) => (latest = s) })],
    content: html,
  });
  return { editor, suggestions: () => latest, ai: () => latest.filter((s) => s.source === "ai") };
}

/** An AI match on the first occurrence of `quote` in `text`. */
function aiMatch(text: string, quote: string, overrides: Partial<RuleMatch> = {}): RuleMatch {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`"${quote}" is not in the text`);
  return {
    ruleId: "ai",
    category: "clarity",
    start,
    end: start + quote.length,
    message: "Claim is stronger than the evidence",
    explanation: "A reader may doubt it.",
    replacements: ["suggest"],
    ...overrides,
  };
}

const P = "These results prove that the method works.";

describe("external (AI) matches in the editor", () => {
  it("shows an AI match at the right document position, marked as AI", () => {
    const { editor, ai, suggestions } = makeEditor(`<p>Intro.</p><p>${P}</p>`);
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "prove")]]]));
    const [s] = ai();
    expect(s).toMatchObject({ ruleId: "ai", source: "ai", category: "clarity" });
    expect(editor.state.doc.textBetween(s!.from, s!.to)).toBe("prove");
    // The underline is drawn, with its own class.
    const el = editor.view.dom.querySelector(".polaris-suggestion--ai");
    expect(el?.textContent).toBe("prove");
    expect(suggestions().filter((x) => x.source === "rules")).toHaveLength(0);
    editor.destroy();
  });

  it("marks rule matches as coming from the rules", () => {
    const { editor, suggestions } = makeEditor("<p>We don't know.</p>");
    expect(suggestions()[0]).toMatchObject({ ruleId: "contractions", source: "rules" });
    editor.destroy();
  });

  it("only shows a result on the exact text it was computed for", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p><p>${P} Also here.</p>`);
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "prove")]]]));
    // The second paragraph contains the same words but is a different text.
    expect(ai()).toHaveLength(1);
    expect(ai()[0]!.blockText).toBe(P);

    // Edit the paragraph: its text no longer matches, so the AI match goes.
    editor.commands.insertContentAt(2, "So ");
    expect(ai()).toHaveLength(0);
    editor.destroy();
  });

  it("shows the same result on two paragraphs with identical text, each with its own key", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p><p>${P}</p>`);
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "prove")]]]));
    expect(ai()).toHaveLength(2);
    expect(new Set(ai().map((s) => s.key)).size).toBe(2);
    editor.destroy();
  });

  it("replaces the previous set of external matches", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p>`);
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "prove")]]]));
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "method")]]]));
    expect(ai().map((s) => s.blockText.slice(s.start, s.end))).toEqual(["method"]);
    setExternalMatches(editor.view, new Map());
    expect(ai()).toHaveLength(0);
    editor.destroy();
  });

  it("lets a rule match win over an overlapping AI match", () => {
    const text = "We don't know if this proves anything.";
    const { editor, suggestions } = makeEditor(`<p>${text}</p>`);
    setExternalMatches(
      editor.view,
      new Map([[text, [aiMatch(text, "don't know"), aiMatch(text, "proves")]]]),
    );
    expect(suggestions().map((s) => `${s.source}:${text.slice(s.start, s.end)}`)).toEqual([
      "rules:don't",
      "ai:proves",
    ]);
    editor.destroy();
  });

  it("does not let a dismissed rule match hide an overlapping AI match", () => {
    const text = "We don't know if this proves anything.";
    const { editor, suggestions, ai } = makeEditor(`<p>${text}</p>`);
    const contraction = suggestions().find((s) => s.ruleId === "contractions")!;
    dismissSuggestion(editor.view, contraction.key);
    setExternalMatches(editor.view, new Map([[text, [aiMatch(text, "don't know")]]]));
    expect(suggestions().map((s) => `${s.source}:${text.slice(s.start, s.end)}`)).toEqual([
      "ai:don't know",
    ]);
    // Dismissing that one too leaves the span clear.
    dismissSuggestion(editor.view, ai()[0]!.key);
    expect(suggestions()).toHaveLength(0);
    editor.destroy();
  });

  it("does not let a dismissed AI match hide a later, overlapping AI match", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p>`);
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "prove")]]]));
    dismissSuggestion(editor.view, ai()[0]!.key);
    setExternalMatches(
      editor.view,
      new Map([[P, [aiMatch(P, "prove"), aiMatch(P, "results prove", { message: "Other" })]]]),
    );
    expect(ai().map((s) => P.slice(s.start, s.end))).toEqual(["results prove"]);
    editor.destroy();
  });

  it("does not let a long-sentence span block AI matches inside it", () => {
    const text = `${"The study that we ran over several years in many schools ".repeat(4)}proves that it works.`;
    const { editor, suggestions } = makeEditor(`<p>${text}</p>`);
    setExternalMatches(editor.view, new Map([[text, [aiMatch(text, "proves")]]]));
    expect(suggestions().map((s) => s.ruleId)).toEqual(
      expect.arrayContaining(["long-sentence", "ai"]),
    );
    editor.destroy();
  });

  it("applies an AI replacement through the usual path", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p>`);
    setExternalMatches(editor.view, new Map([[P, [aiMatch(P, "prove")]]]));
    applySuggestion(editor.view, ai()[0]!, "suggest");
    expect(editor.getText()).toBe("These results suggest that the method works.");
    expect(ai()).toHaveLength(0);
    editor.destroy();
  });

  it("dismisses an AI match, and the dismissal survives new results", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p>`);
    const matches = new Map([[P, [aiMatch(P, "prove")]]]);
    setExternalMatches(editor.view, matches);
    dismissSuggestion(editor.view, ai()[0]!.key);
    expect(ai()).toHaveLength(0);
    setExternalMatches(editor.view, new Map(matches));
    expect(ai()).toHaveLength(0);
    editor.destroy();
  });

  it("keeps setting matches out of the undo history", () => {
    const { editor } = makeEditor("<p>Start.</p>");
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " More.");
    setExternalMatches(editor.view, new Map([["Start. More.", [aiMatch("Start. More.", "More")]]]));
    editor.commands.undo();
    expect(editor.getText()).toBe("Start.");
    editor.destroy();
  });

  it("ignores AI matches whose offsets do not fit the paragraph", () => {
    const { editor, ai } = makeEditor(`<p>${P}</p>`);
    setExternalMatches(
      editor.view,
      new Map([
        [
          P,
          [
            { ...aiMatch(P, "prove"), end: P.length + 5 },
            { ...aiMatch(P, "prove"), end: 0 },
          ],
        ],
      ]),
    );
    expect(ai()).toHaveLength(0);
    editor.destroy();
  });
});

describe("mergeMatches", () => {
  const rule = (start: number, end: number, ruleId = "contractions"): RuleMatch => ({
    ruleId,
    category: "formality",
    start,
    end,
    message: "",
    explanation: "",
    replacements: [],
  });
  const ai = (start: number, end: number) => ({
    ...rule(start, end, "ai"),
    category: "clarity" as const,
  });

  it("returns the rule matches untouched when there are no AI matches", () => {
    const rules = [rule(0, 3)];
    expect(mergeMatches("abcdef", rules, [])).toBe(rules);
  });

  it("drops AI matches that overlap a rule match or an earlier AI match, and sorts", () => {
    const merged = mergeMatches(
      "0123456789",
      [rule(2, 4)],
      [ai(6, 8), ai(3, 5), ai(7, 9), ai(0, 2)],
    );
    expect(merged.map((m) => `${m.ruleId}:${m.start}-${m.end}`)).toEqual([
      "ai:0-2",
      "contractions:2-4",
      "ai:6-8",
    ]);
  });

  it("keeps AI matches that only touch a rule match", () => {
    expect(mergeMatches("0123456789", [rule(2, 4)], [ai(4, 6)])).toHaveLength(2);
  });

  it("does not modify the rule matches it was given", () => {
    const rules = [rule(2, 4)];
    mergeMatches("0123456789", rules, [ai(5, 6)]);
    expect(rules).toHaveLength(1);
  });
});
