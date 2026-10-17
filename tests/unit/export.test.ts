// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { Packer } from "docx";
import JSZip from "jszip";
import { buildArchive, documentMarkdown } from "@/lib/export/archive";
import { buildDocx } from "@/lib/export/docx";
import { exportFileName, slugify, uniqueSlugs } from "@/lib/export/filename";
import { escapeMarkdown, toMarkdown } from "@/lib/export/markdown";
import { toPlainText } from "@/lib/export/text";
import { markdownToDocument } from "@/lib/import/markdown";
import type { DocumentDTO } from "@/lib/documents/service";

type Mark = { type: string; attrs?: Record<string, unknown> };
const t = (text: string, ...marks: (string | Mark)[]): JSONContent => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const link = (href: string) => ({ type: "link", attrs: { href } });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const h = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const fn = (content: string): JSONContent => ({
  type: "footnote",
  attrs: { id: content, content },
});
const li = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const ul = (...items: JSONContent[]): JSONContent => ({ type: "bulletList", content: items });
const ol = (...items: JSONContent[]): JSONContent => ({
  type: "orderedList",
  attrs: { start: 1, type: null },
  content: items,
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const br: JSONContent = { type: "hardBreak" };

/** A document with everything the exporters handle. */
const SAMPLE = doc(
  h(1, "Introduction"),
  p(
    t("Plain, "),
    t("bold", "bold"),
    t(", "),
    t("italic", "italic"),
    t(", "),
    t("underlined", "underline"),
    t(" and "),
    t("a link", link("https://example.com/a_(b)")),
    t("."),
    fn("Smith (2020), p. 4."),
    t(" Line one"),
    br,
    t("line two."),
  ),
  h(2, "Method"),
  ul(li(p(t("Point one")), ul(li(p(t("Nested point"))))), li(p(t("Point two")))),
  ol(li(p(t("Step one"))), li(p(t("Step two")))),
  { type: "blockquote", content: [p(t("A quoted passage."))] },
  h(3, "Detail"),
  p(t("Closing words."), fn("Second note.")),
);

/** `before` and then `after` in one paragraph (w:p) of the XML. */
const inOneParagraph = (before: string, after: string) =>
  new RegExp(`${before}(?:(?!</w:p>)[\\s\\S])*?${after}`);

async function unzipDocx(content: JSONContent, title: string) {
  const buffer = await Packer.toBuffer(buildDocx(content, title));
  const zip = await JSZip.loadAsync(buffer);
  const read = (name: string) => zip.file(name)?.async("string") ?? Promise.resolve("");
  return {
    document: await read("word/document.xml"),
    footnotes: await read("word/footnotes.xml"),
    rels: await read("word/_rels/document.xml.rels"),
    styles: await read("word/styles.xml"),
    numbering: await read("word/numbering.xml"),
  };
}

describe("Word export (docx)", () => {
  it("writes the title, heading styles, formatted runs, lists, quotes and breaks", async () => {
    const { document, styles, numbering } = await unzipDocx(SAMPLE, "Climate essay");
    expect(document).toMatch(inOneParagraph('<w:pStyle w:val="Title"/>', "Climate essay"));
    for (const [style, text] of [
      ["Heading1", "Introduction"],
      ["Heading2", "Method"],
      ["Heading3", "Detail"],
    ]) {
      expect(document).toMatch(inOneParagraph(`<w:pStyle w:val="${style}"/>`, text!));
    }
    // Each run's own properties: <w:r><w:rPr>…</w:rPr><w:t>text</w:t></w:r>.
    const run = (prop: string, text: string) =>
      new RegExp(
        `<w:r><w:rPr>(?:(?!</w:r>).)*${prop}(?:(?!</w:r>).)*<w:t[^>]*>${text}</w:t></w:r>`,
      );
    expect(document).toMatch(run("<w:b/>", "bold"));
    expect(document).toMatch(run("<w:i/>", "italic"));
    expect(document).toMatch(run('<w:u w:val="single"/>', "underlined"));
    expect(document).not.toMatch(run("<w:b/>", "italic"));
    expect(document).toContain("<w:br/>");
    // Five list paragraphs, the nested one at level 1.
    expect(document.match(/<w:numPr>/g)).toHaveLength(5);
    expect(document).toMatch(inOneParagraph('<w:ilvl w:val="1"/>', "Nested point"));
    expect(numbering).toContain('w:val="bullet"');
    expect(numbering).toContain('w:val="decimal"');
    expect(document).toMatch(
      inOneParagraph('<w:pStyle w:val="PolarisQuote"/>', "A quoted passage"),
    );
    // A readable default: 12 pt (24 half-points) Times New Roman, 1.5 line spacing.
    expect(styles).toContain('w:ascii="Times New Roman"');
    expect(styles).toContain('<w:sz w:val="24"/>');
    expect(styles).toContain('w:line="360"');
  });

  it("writes links as real hyperlinks and footnotes as real Word footnotes", async () => {
    const { document, footnotes, rels } = await unzipDocx(SAMPLE, "Climate essay");
    const id = /<w:hyperlink [^>]*r:id="([^"]+)"[^>]*>(?:(?!<\/w:hyperlink>)[\s\S])*?a link/.exec(
      document,
    )?.[1];
    expect(id).toBeTruthy();
    expect(rels).toMatch(
      new RegExp(
        `Id="${id}"[^>]*Target="https://example.com/a_\\(b\\)"[^>]*TargetMode="External"|Target="https://example.com/a_\\(b\\)"[^>]*TargetMode="External"[^>]*Id="${id}"`,
      ),
    );
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).toContain('<w:footnoteReference w:id="2"/>');
    expect(footnotes).toMatch(
      /<w:footnote w:id="1">(?:(?!<\/w:footnote>)[\s\S])*Smith \(2020\), p\. 4\./,
    );
    expect(footnotes).toMatch(/<w:footnote w:id="2">(?:(?!<\/w:footnote>)[\s\S])*Second note\./);
    // The footnote text is not in the body.
    expect(document).not.toContain("Smith (2020)");
  });

  it("exports a disallowed link as plain text", async () => {
    const { document, rels } = await unzipDocx(doc(p(t("click", link("javascript:alert(1)")))), "");
    expect(document).not.toContain("<w:hyperlink");
    expect(document).toContain("click");
    expect(rels).not.toContain("javascript");
    expect(document).not.toContain('w:val="Title"');
  });
});

describe("Markdown export", () => {
  it("writes CommonMark: headings, marks, links, lists, quotes, breaks and footnotes", () => {
    const md = toMarkdown(SAMPLE, "Climate essay");
    expect(md).toBe(
      [
        "# Climate essay",
        "# Introduction",
        "Plain, **bold**, *italic*, underlined and [a link](<https://example.com/a_(b)>).[^1] Line one\\\nline two.",
        "## Method",
        "- Point one\n  - Nested point\n- Point two",
        "1. Step one\n2. Step two",
        "> A quoted passage.",
        "### Detail",
        "Closing words.[^2]",
        "[^1]: Smith (2020), p. 4.\n[^2]: Second note.",
      ].join("\n\n") + "\n",
    );
  });

  it("escapes characters that would otherwise be read as Markdown", () => {
    expect(escapeMarkdown("a*b*c _x_ snake_case `code` [link](x) <b> ~~s~~ | \\ &amp; & 5")).toBe(
      "a\\*b\\*c \\_x\\_ snake_case \\`code\\` \\[link\\](x) \\<b> \\~\\~s\\~\\~ \\| \\\\ \\&amp; & 5",
    );
    const md = toMarkdown(
      doc(
        p(t("# not a heading")),
        p(t("- not a list")),
        p(t("1. not a list either")),
        p(t("> not a quote")),
        p(t("[^1] not a footnote")),
        p(t("===")),
        p(t("     indented, not code")),
      ),
    );
    expect(md).toBe(
      "\\# not a heading\n\n\\- not a list\n\n1\\. not a list either\n\n\\> not a quote\n\n\\[^1\\] not a footnote\n\n\\===\n\nindented, not code\n",
    );
  });

  it("nests marks and keeps spaces outside the delimiters", () => {
    expect(toMarkdown(doc(p(t("bold ", "bold"), t("both", "bold", "italic"), t(" after"))))).toBe(
      "**bold *both*** after\n",
    );
    expect(toMarkdown(doc(p(t("x"), t(" spaced ", "bold"), t("y"))))).toBe("x **spaced** y\n");
    // A code span that ends with a backtick is padded on both sides (CommonMark strips them).
    expect(toMarkdown(doc(p(t("a `tick`", "code"))))).toBe("`` a `tick` ``\n");
    expect(toMarkdown(doc(p(t("x * y", "code"))))).toBe("`x * y`\n");
  });

  it("round-trips through the importer without losing text, structure or footnotes", () => {
    const tricky = doc(
      h(2, "Results #1"),
      p(t("Stars * and _underscores_ and [brackets] and <tags> & 3 < 4 > 2 ~ | \\ `ticks`.")),
      p(t("1. Looks like a list"), br, t("- and so does this")),
      p(t("Snake_case words, C# and 50% done!"), fn("Note with *stars* and [brackets].")),
      ul(li(p(t("Item"), fn("In a list."))), li(p(t("Other")), ol(li(p(t("Inner")))))),
      { type: "blockquote", content: [p(t("Quoted "), t("bold", "bold"))] },
      {
        type: "codeBlock",
        attrs: { language: "js" },
        content: [t("const a = `x` * 2;\n// [^1]: not a note")],
      },
      p(t("Link to "), t("a page", link("https://example.com/x?y=1&z=2"))),
    );
    const md = toMarkdown(tricky, "Title: *odd*");
    const back = markdownToDocument(md, "x.md");
    expect(back.title).toBe("Title: *odd*");
    const text = (d: JSONContent) =>
      JSON.stringify(d, (k, v) => (k === "id" || k === "marks" ? undefined : v));
    expect(text(back.content)).toBe(text(tricky));
    const footnotes = (d: JSONContent) =>
      JSON.stringify(d).match(/"content":"(?:Note|In a)[^"]*"/g);
    expect(footnotes(back.content)).toEqual(footnotes(tricky));
    // Marks survive too, except underline (Markdown has none).
    expect(JSON.stringify(back.content)).toContain('"type":"bold"');
    expect(JSON.stringify(back.content)).toContain('"href":"https://example.com/x?y=1&z=2"');
  });
});

describe("plain text export", () => {
  it("separates paragraphs with blank lines, keeps list markers and lists footnotes at the end", () => {
    expect(toPlainText(SAMPLE, "Climate essay")).toBe(
      [
        "Climate essay",
        "Introduction",
        "Plain, bold, italic, underlined and a link.[1] Line one\nline two.",
        "Method",
        "- Point one\n  - Nested point\n- Point two",
        "1. Step one\n2. Step two",
        "    A quoted passage.",
        "Detail",
        "Closing words.[2]",
        "Footnotes\n\n1. Smith (2020), p. 4.\n2. Second note.",
      ].join("\n\n") + "\n",
    );
  });

  it("has no footnotes section without footnotes, and no title line without a title", () => {
    expect(toPlainText(doc(p(t("Just this."))))).toBe("Just this.\n");
  });
});

describe("file names", () => {
  it("slugs the title, with a fallback", () => {
    expect(exportFileName("Climate essay", "docx")).toBe("climate-essay.docx");
    expect(slugify("  Économie: l’été 2026! ")).toBe("economie-l-ete-2026");
    expect(slugify("")).toBe("untitled");
    expect(slugify("???")).toBe("untitled");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(80);
    expect(slugify(`${"word ".repeat(30)}`)).not.toMatch(/-$/);
  });

  it("makes names unique", () => {
    expect(uniqueSlugs(["Essay", "essay", "Essay 2", "", "Untitled"])).toEqual([
      "essay",
      "essay-2",
      "essay-2-2",
      "untitled",
      "untitled-2",
    ]);
  });
});

describe("data export archive", () => {
  const dto = (over: Partial<DocumentDTO>): DocumentDTO => ({
    id: "d",
    title: "Essay",
    content: doc(p(t("Body"), fn("A note."))),
    plainText: "Body",
    wordCount: 1,
    goals: { citationStyle: "apa" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    ...over,
  });

  it("has one Markdown file per document, uniquely named, and a manifest", async () => {
    const zip = await buildArchive(
      [
        dto({ id: "a" }),
        dto({ id: "b", wordCount: 7 }),
        dto({ id: "c", title: "Notes", content: null, plainText: "Old *text*" }),
      ],
      new Date("2026-10-16T12:00:00Z"),
    );
    expect(Object.keys(zip.files).sort()).toEqual([
      "essay-2.md",
      "essay.md",
      "manifest.json",
      "notes.md",
    ]);
    expect(await zip.file("essay.md")!.async("string")).toBe(
      "# Essay\n\nBody[^1]\n\n[^1]: A note.\n",
    );
    expect(await zip.file("notes.md")!.async("string")).toBe("# Notes\n\nOld \\*text\\*\n");
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.exportedAt).toBe("2026-10-16T12:00:00.000Z");
    expect(manifest.documents[1]).toEqual({
      file: "essay-2.md",
      title: "Essay",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-02-01T00:00:00.000Z",
      wordCount: 7,
      goals: { citationStyle: "apa" },
    });
  });

  it("falls back to the plain text for a document without usable content", () => {
    expect(documentMarkdown({ title: "T", content: { type: "nope" }, plainText: "a\n\nb" })).toBe(
      "# T\n\na\n\nb\n",
    );
  });
});
