// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { blocksFromContent, blocksLayout, isNumberedParagraph } from "@/lib/documents/blocks";
import {
  blockLayout,
  findParagraph,
  findSentence,
  findTextInDoc,
  metricsBlocks,
} from "@/lib/editor/locate";
import { computeMetrics } from "@/lib/text/metrics";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function make(html: string) {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
    content: html,
  });
  return editor;
}

const between = (e: Editor, r: { from: number; to: number } | null) =>
  r ? e.state.doc.textBetween(r.from, r.to, "\n\n") : null;

describe("metricsBlocks", () => {
  it("marks headings and code so the Overview leaves them out of sentence counts", () => {
    const e = make("<h2>Intro</h2><p>One. Two.</p><pre><code>x = 1.</code></pre>");
    expect(metricsBlocks(e.state.doc)).toEqual([
      { text: "Intro", heading: true, code: false },
      { text: "One. Two.", heading: false, code: false },
      { text: "x = 1.", heading: false, code: true },
    ]);
    // The code counts as words ("x", "1"), not as sentences.
    expect(computeMetrics(metricsBlocks(e.state.doc))).toMatchObject({ words: 5, sentences: 2 });
  });
});

describe("blockLayout", () => {
  it("gives each textblock's heading level, and changes when a paragraph becomes a heading", () => {
    const e = make(
      "<h2>Intro</h2><p>One.</p><ul><li><p>Item.</p></li></ul><h3>More</h3><p>End.</p>",
    );
    expect(blockLayout(e.state.doc)).toBe("2,0,0,3,0");
    const text = e.getText({ blockSeparator: "\n\n" });
    // The paragraph "One." becomes a heading: same text, different layout.
    e.chain().setTextSelection(10).setNode("heading", { level: 2 }).run();
    expect(e.getText({ blockSeparator: "\n\n" })).toBe(text);
    expect(blockLayout(e.state.doc)).toBe("2,2,0,3,0");
  });

  it("is the layout the saved JSON gives, so the editor can start with it", () => {
    const e = make(
      "<h1>Title</h1><p></p><blockquote><p>Quoted.</p></blockquote><pre><code>x = 1</code></pre>" +
        "<ol><li><p>One</p></li></ol><h3>End</h3><p>Last.</p>",
    );
    expect(blockLayout(e.state.doc)).toBe("1,0,0,0,0,3,0");
    expect(blocksLayout(blocksFromContent(e.getJSON())!)).toBe(blockLayout(e.state.doc));
  });
});

describe("findSentence", () => {
  it("finds the measured sentence where it was", () => {
    const e = make("<p>Short.</p><p>A much longer sentence sits here. Tiny.</p>");
    const longest = computeMetrics(metricsBlocks(e.state.doc)).longestSentence!;
    expect(between(e, findSentence(e.state.doc, longest))).toBe(
      "A much longer sentence sits here.",
    );
  });

  it("finds it by its text after an edit moved it, and gives up once it is gone", () => {
    const e = make("<p>Short.</p><p>A much longer sentence sits here.</p>");
    const longest = computeMetrics(metricsBlocks(e.state.doc)).longestSentence!;
    e.commands.setContent(
      "<p>New first paragraph.</p><p>Short.</p><p>A much longer sentence sits here.</p>",
    );
    expect(between(e, findSentence(e.state.doc, longest))).toBe(
      "A much longer sentence sits here.",
    );
    e.commands.setContent("<p>Everything changed.</p>");
    expect(findSentence(e.state.doc, longest)).toBeNull();
  });
});

describe("findTextInDoc", () => {
  it("finds a quote across marks, with typographic differences", () => {
    const e = make("<p>Results <strong>were</strong> “mixed” at best.</p>");
    expect(between(e, findTextInDoc(e.state.doc, 'were "mixed"'))).toBe("were “mixed”");
  });

  it("finds a quote that runs across a paragraph break", () => {
    const e = make("<p>End of one.</p><p>Start of two.</p>");
    expect(between(e, findTextInDoc(e.state.doc, "one. Start"))).toBe("one.\n\nStart");
  });

  it("finds text after a hard break, at the right positions", () => {
    const e = make("<p>Line one<br>line two here</p>");
    expect(between(e, findTextInDoc(e.state.doc, "two here"))).toBe("two here");
  });

  it("returns null when the passage is no longer there", () => {
    const e = make("<p>Nothing to see.</p>");
    expect(findTextInDoc(e.state.doc, "nine students")).toBeNull();
    expect(findTextInDoc(e.state.doc, "")).toBeNull();
  });
});

describe("findParagraph", () => {
  it("counts paragraphs as the review prompt does: no headings, no empty ones", () => {
    const e = make(
      "<h1>Title</h1><p>First.</p><p></p><h2>Part</h2><ul><li><p>Second.</p></li></ul><p>Third.</p>",
    );
    expect(between(e, findParagraph(e.state.doc, 1))).toBe("First.");
    expect(between(e, findParagraph(e.state.doc, 2))).toBe("Second.");
    expect(between(e, findParagraph(e.state.doc, 3))).toBe("Third.");
    expect(findParagraph(e.state.doc, 4)).toBeNull();
    expect(findParagraph(e.state.doc, 0)).toBeNull();

    // The server numbers the same document's JSON the same way.
    const server = blocksFromContent(e.getJSON())!
      .filter(isNumberedParagraph)
      .map((b) => b.text);
    expect(server).toEqual(["First.", "Second.", "Third."]);
  });
});
