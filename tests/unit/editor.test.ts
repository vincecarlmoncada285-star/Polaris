// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { collectTextBlocks, OBJECT_REPLACEMENT } from "@/lib/editor/textblocks";
import {
  Suggestions,
  applySuggestion,
  dismissSuggestion,
  suggestionsKey,
  type Suggestion,
} from "@/lib/editor/suggestions";

function makeEditor(html: string) {
  let latest: Suggestion[] = [];
  const editor = new Editor({
    element: undefined,
    extensions: [StarterKit, Suggestions.configure({ onChange: (s) => (latest = s) })],
    content: html,
  });
  return { editor, suggestions: () => latest, state: () => suggestionsKey.getState(editor.state)! };
}

describe("collectTextBlocks", () => {
  it("maps text offsets to document positions across marks and hard breaks", () => {
    const { editor } = makeEditor("<h1>Title</h1><p>a <strong>bold</strong><br>next</p>");
    const blocks = collectTextBlocks(editor.state.doc);
    expect(blocks.map((b) => b.text)).toEqual(["Title", `a bold${OBJECT_REPLACEMENT}next`]);
    const p = blocks[1]!;
    const from = p.posAt(p.text.indexOf("next"));
    expect(editor.state.doc.textBetween(from, from + 4)).toBe("next");
    expect(editor.state.doc.textBetween(p.posAt(2), p.posAt(6))).toBe("bold");
    editor.destroy();
  });
});

describe("Suggestions extension", () => {
  it("finds suggestions with correct positions", () => {
    const { editor, suggestions } = makeEditor("<p>Intro.</p><p>We don't know.</p>");
    const s = suggestions().find((x) => x.ruleId === "contractions")!;
    expect(editor.state.doc.textBetween(s.from, s.to)).toBe("don't");
    editor.destroy();
  });

  it("applies a replacement and drops the suggestion", () => {
    const { editor, suggestions } = makeEditor("<p>We don't know.</p>");
    applySuggestion(editor.view, suggestions()[0]!, "do not");
    expect(editor.getText()).toBe("We do not know.");
    expect(suggestions()).toHaveLength(0);
    editor.destroy();
  });

  it("removes a deleted intensifier with its space", () => {
    const { editor, suggestions } = makeEditor("<p>A very large effect.</p>");
    applySuggestion(editor.view, suggestions().find((s) => s.ruleId === "vague-intensifiers")!, "");
    expect(editor.getText()).toBe("A large effect.");
    editor.destroy();
  });

  it("keeps a dismissal when the paragraph is edited elsewhere", () => {
    const { editor, suggestions } = makeEditor("<p>It's fine.</p>");
    dismissSuggestion(editor.view, suggestions()[0]!.key);
    expect(suggestions()).toHaveLength(0);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " More text.");
    expect(suggestions()).toHaveLength(0);
    editor.destroy();
  });

  it("updates positions after edits earlier in the document", () => {
    const { editor, suggestions } = makeEditor("<p>One.</p><p>We can't.</p>");
    editor.commands.insertContentAt(1, "Prefix ");
    const s = suggestions()[0]!;
    expect(editor.state.doc.textBetween(s.from, s.to)).toBe("can't");
    editor.destroy();
  });
});
