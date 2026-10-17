// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import JSZip from "jszip";
import { DocxReadError, docxToDocument } from "@/lib/import/docx";
import { htmlToDocument, sanitizeImportedDom } from "@/lib/import/html";
import {
  IMPORT_ERRORS,
  IMPORT_MAX_BYTES,
  ImportError,
  convertFile,
  decodeText,
  importKind,
} from "@/lib/import";
import { extractFootnoteDefinitions, markdownToDocument } from "@/lib/import/markdown";
import { droppedSummary, noneDropped } from "@/lib/import/notice";
import { textToDocument, textToParagraphs } from "@/lib/import/text";

/** Every node of a type, depth first. */
function nodes(doc: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) found.push(n);
    n.content?.forEach(walk);
  };
  walk(doc);
  return found;
}

const textOf = (n: JSONContent): string =>
  n.type === "text" ? (n.text ?? "") : (n.content ?? []).map(textOf).join("");

const marksOn = (doc: JSONContent, text: string) =>
  nodes(doc, "text")
    .find((t) => t.text === text)
    ?.marks?.map((m) => m.type)
    .sort();

const footnotes = (doc: JSONContent) => nodes(doc, "footnote").map((f) => f.attrs?.content);

describe("sanitizeImportedDom", () => {
  const dirty = `
    <h1 onclick="steal()" style="color:red" class="x" id="y">Heading</h1>
    <script>window.pwned = 1</script><style>body { display: none }</style>
    <p onmouseover="steal()" style="font-size: 40px">Text <img src="a.png" onerror="steal()">
      <a href="javascript:alert(1)" onclick="x()">bad link</a>
      <a href="https://example.com" target="_top" style="x">good link</a>
      <a href="//evil.example">sly link</a></p>
    <iframe src="https://evil.example"></iframe><object data="x.swf"></object>
    <form action="/steal"><input name="password"><button>Go</button></form>
    <table><tr><td>Cell <img src="b.png"><table><tr><td>inner</td></tr></table></td></tr></table>
    <h5>Deep heading</h5>
    <sup data-footnote data-content="  The   note. " data-id="evil" onclick="x()"><b>junk</b></sup>
    <svg><script>steal()</script></svg>`;

  it("removes scripts, styles, frames, forms, images and tables, and counts what a writer misses", () => {
    const doc = new DOMParser().parseFromString(dirty, "text/html");
    const dropped = sanitizeImportedDom(doc);
    expect(dropped).toEqual({ ...noneDropped(), images: 2, tables: 1, embedded: 3 });
    const html = doc.body.innerHTML;
    for (const tag of [
      "script",
      "style",
      "img",
      "iframe",
      "object",
      "form",
      "input",
      "button",
      "table",
      "svg",
    ]) {
      expect(doc.querySelector(tag), tag).toBeNull();
    }
    expect(html).not.toContain("steal");
    expect(html).not.toContain("pwned");
    expect(html).not.toContain("inner");
  });

  it("strips every on* handler, style, class and id, and keeps only allowed links", () => {
    const doc = new DOMParser().parseFromString(dirty, "text/html");
    sanitizeImportedDom(doc);
    for (const el of doc.body.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        expect(attr.name).not.toMatch(/^on|^style$|^class$|^id$|^target$|^data-id$/);
      }
    }
    const links = [...doc.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com"]);
    // The text of a refused link stays.
    expect(doc.body.textContent).toContain("bad link");
    expect(doc.body.textContent).toContain("sly link");
    expect(doc.querySelector("h5")).toBeNull();
    expect(doc.querySelector("h3")?.textContent).toBe("Deep heading");
    const sup = doc.querySelector("sup[data-footnote]")!;
    expect(sup.getAttribute("data-content")).toBe("The note.");
    expect(sup.innerHTML).toBe("");
  });

  it("converts with the editor's schema: unknown elements keep their text, nothing else", () => {
    const result = htmlToDocument(
      `<h1>Essay</h1><p>Start <span style="x">span</span> <marquee>moving</marquee> <u>under</u></p>${dirty}`,
      { fileName: "essay.html" },
    );
    expect(result.title).toBe("Essay");
    expect(result.plainText).toContain("Start span moving under");
    expect(result.plainText).not.toContain("pwned");
    expect(JSON.stringify(result.content)).not.toMatch(/onclick|onerror|style|javascript/i);
    expect(footnotes(result.content)).toEqual(["The note."]);
    // The footnote gets a fresh id, not the one in the file.
    expect(nodes(result.content, "footnote")[0]!.attrs?.id).toMatch(/^fn-/);
    expect(result.dropped.images).toBe(2);
  });

  it("never touches the page it runs in", () => {
    const before = document.body.innerHTML;
    htmlToDocument('<p>x</p><img src="x" onerror="document.body.dataset.hit = 1">', {
      fileName: "x.html",
    });
    expect(document.body.innerHTML).toBe(before);
    expect(document.body.dataset.hit).toBeUndefined();
  });

  it("takes the title from the first H1 (out of the body), else from the file name", () => {
    const a = htmlToDocument("<p>Intro</p><h1>Main</h1><h1>Second</h1><p>Body</p>", {
      fileName: "a.md",
    });
    expect(a.title).toBe("Main");
    expect(nodes(a.content, "heading").map(textOf)).toEqual(["Second"]);
    const b = htmlToDocument("<h2>Only a section</h2><p>Body</p>", { fileName: "My notes.v2.md" });
    expect(b.title).toBe("My notes.v2");
    expect(nodes(b.content, "heading").map(textOf)).toEqual(["Only a section"]);
  });
});

describe("droppedSummary", () => {
  it("says what was left out, in plain words", () => {
    expect(droppedSummary(noneDropped())).toBeNull();
    expect(droppedSummary({ ...noneDropped(), images: 2, tables: 1 })).toBe(
      "2 images and 1 table were left out.",
    );
    expect(droppedSummary({ ...noneDropped(), images: 1 })).toBe("1 image was left out.");
    expect(droppedSummary({ ...noneDropped(), images: 1, comments: 3, trackedChanges: 2 })).toBe(
      "1 image, 3 comments and 2 tracked deletions were left out.",
    );
  });
});

/** A 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function docxFixture(children: Paragraph[] | (Paragraph | Table)[], extra: object = {}) {
  const doc = new Document({ ...extra, sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

describe("docx import (mammoth)", () => {
  it("keeps the title, headings, lists, emphasis, links and footnotes; drops images and tables", async () => {
    const data = await docxFixture(
      [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Climate essay")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Introduction")] }),
        new Paragraph({
          children: [
            new TextRun("Warming is "),
            new TextRun({ text: "real", bold: true }),
            new TextRun(", "),
            new TextRun({ text: "measured", italics: true }),
            new TextRun(" and "),
            new TextRun({ text: "fast", underline: {} }),
            new TextRun("."),
            new FootnoteReferenceRun(1),
            new TextRun(" See "),
            new ExternalHyperlink({
              link: "https://example.org/report",
              children: [new TextRun({ text: "the report", style: "Hyperlink" })],
            }),
            new TextRun("."),
          ],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Causes")] }),
        new Paragraph({ text: "Emissions", bullet: { level: 0 } }),
        new Paragraph({ text: "Coal", bullet: { level: 1 } }),
        new Paragraph({ text: "Land use", bullet: { level: 0 } }),
        new Paragraph({
          children: [
            new ImageRun({ type: "png", data: PNG, transformation: { width: 10, height: 10 } }),
          ],
        }),
        new Table({
          rows: [
            new TableRow({
              children: [new TableCell({ children: [new Paragraph("Table text")] })],
            }),
          ],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Sub")] }),
        new Paragraph("Last paragraph."),
      ],
      { footnotes: { 1: { children: [new Paragraph("IPCC (2021), p. 4.")] } } },
    );
    const result = await docxToDocument(data, "climate.docx");
    expect(result.title).toBe("Climate essay");
    expect(nodes(result.content, "heading").map((h) => [h.attrs?.level, textOf(h)])).toEqual([
      [1, "Introduction"],
      [2, "Causes"],
      [3, "Sub"],
    ]);
    expect(marksOn(result.content, "real")).toEqual(["bold"]);
    expect(marksOn(result.content, "measured")).toEqual(["italic"]);
    expect(marksOn(result.content, "fast")).toEqual(["underline"]);
    const link = nodes(result.content, "text").find((t) => t.text === "the report")!;
    expect(link.marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: "https://example.org/report" },
    });
    expect(footnotes(result.content)).toEqual(["IPCC (2021), p. 4."]);
    // The footnote's text is not in the body, nor its "[1]" marker or back link.
    expect(result.plainText).not.toMatch(/IPCC|\[1\]|↑/);
    const [list] = nodes(result.content, "bulletList");
    expect(list!.content!.map((li) => textOf(li.content![0]!))).toEqual(["Emissions", "Land use"]);
    expect(nodes(list!, "bulletList")).toHaveLength(2); // the list and the nested one
    expect(textOf(nodes(list!, "bulletList")[1]!)).toBe("Coal");
    expect(result.dropped).toMatchObject({ images: 1, tables: 1 });
    expect(result.plainText).not.toContain("Table text");
    expect(result.plainText).toContain("Last paragraph.");
  });

  it("uses the first heading 1 as the title without a Title style, and counts comments and deletions", async () => {
    const data = await docxFixture(
      [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Lab report")] }),
        new Paragraph({
          children: [
            new CommentRangeStart(0),
            new TextRun("Kept text"),
            new CommentRangeEnd(0),
            new TextRun({ children: [new CommentReference(0)] }),
            new DeletedTextRun({
              text: " removed words",
              id: 1,
              author: "A",
              date: "2026-01-01T00:00:00Z",
            }),
          ],
        }),
        new Paragraph({ text: "First step", numbering: { reference: "steps", level: 0 } }),
        new Paragraph({ text: "Second step", numbering: { reference: "steps", level: 0 } }),
      ],
      {
        comments: {
          children: [
            { id: 0, author: "Tutor", date: new Date(0), children: [new Paragraph("Cite this")] },
          ],
        },
        numbering: {
          config: [{ reference: "steps", levels: [{ level: 0, format: "decimal", text: "%1." }] }],
        },
      },
    );
    const result = await docxToDocument(data, "report.docx");
    expect(result.title).toBe("Lab report");
    expect(nodes(result.content, "heading")).toHaveLength(0);
    expect(result.plainText).toContain("Kept text");
    expect(result.plainText).not.toMatch(/removed words|Cite this/);
    expect(result.dropped).toMatchObject({ comments: 1, trackedChanges: 1 });
    expect(nodes(result.content, "orderedList")[0]!.content!.map(textOf)).toEqual([
      "First step",
      "Second step",
    ]);
  });

  it("refuses a file that is not a Word document", async () => {
    const garbage = new TextEncoder().encode("this is not a zip file").buffer as ArrayBuffer;
    await expect(docxToDocument(garbage, "x.docx")).rejects.toBeInstanceOf(DocxReadError);
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const notWord = await zip.generateAsync({ type: "arraybuffer" });
    await expect(docxToDocument(notWord, "x.docx")).rejects.toBeInstanceOf(DocxReadError);
  });
});

describe("markdown import (marked, GFM)", () => {
  const MD = `# Homework essay

Intro with *emphasis*, **strong**, ~~struck~~ and \`code\`, plus a [link](https://example.com "T").[^src]

## Evidence

1. First
   - nested bullet
     - deeper
2. Second[^2]

> A quoted line.

A [bad link](javascript:alert(1)) and an ![image](https://example.com/x.png).

<script>alert("x")</script>

Inline <b onclick="x()">raw</b> html and [^missing] reference.

\`\`\`
[^src]: not a definition, inside code
\`\`\`

[^src]: Smith, *Homework*, 2020.
[^2]: A second note
    that continues here.
`;

  it("keeps headings, nested lists, emphasis, links and footnotes", () => {
    const result = markdownToDocument(MD, "essay.md");
    expect(result.title).toBe("Homework essay");
    expect(nodes(result.content, "heading").map(textOf)).toEqual(["Evidence"]);
    expect(marksOn(result.content, "emphasis")).toEqual(["italic"]);
    expect(marksOn(result.content, "strong")).toEqual(["bold"]);
    expect(marksOn(result.content, "struck")).toEqual(["strike"]);
    expect(marksOn(result.content, "code")).toEqual(["code"]);
    const link = nodes(result.content, "text").find((t) => t.text === "link")!;
    expect(link.marks?.[0]?.attrs?.href).toBe("https://example.com");
    const [ol] = nodes(result.content, "orderedList");
    expect(ol!.content!.map((li) => textOf(li.content![0]!))).toEqual(["First", "Second"]);
    expect(nodes(ol!, "bulletList")).toHaveLength(2);
    expect(nodes(result.content, "blockquote").map(textOf)).toEqual(["A quoted line."]);
    expect(footnotes(result.content)).toEqual([
      "Smith, Homework, 2020.",
      "A second note that continues here.",
    ]);
    // Definitions leave the body; the one inside a code block is code, not a definition.
    expect(result.plainText).not.toContain("Smith");
    expect(nodes(result.content, "codeBlock").map(textOf)).toEqual([
      "[^src]: not a definition, inside code",
    ]);
    // A reference without a definition stays as text.
    expect(result.plainText).toContain("[^missing] reference");
  });

  it("drops disallowed links and images but keeps their text", () => {
    const result = markdownToDocument(MD, "essay.md");
    expect(result.plainText).toContain("A bad link and an .");
    expect(JSON.stringify(result.content)).not.toContain("javascript");
    expect(result.dropped.images).toBe(1);
  });

  it("shows raw HTML as text, never as markup", () => {
    const result = markdownToDocument(MD, "essay.md");
    expect(result.plainText).toContain('<script>alert("x")</script>');
    expect(result.plainText).toContain('Inline <b onclick="x()">raw</b> html');
    expect(marksOn(result.content, "raw")).toBeUndefined();
    const doc = markdownToDocument(
      '<img src=x onerror="alert(1)">\n\n<sup data-footnote data-content="fake">x</sup>',
      "a.md",
    );
    expect(doc.dropped.images).toBe(0);
    expect(footnotes(doc.content)).toEqual([]);
    expect(doc.plainText).toContain("<img src=x onerror=");
  });

  it("collects definitions outside code fences only", () => {
    const { body, definitions } = extractFootnoteDefinitions(
      "Text[^a]\n\n~~~\n[^a]: in code\n~~~\n\n[^A]: Outside\n   [^b]: three spaces\n",
    );
    expect([...definitions]).toEqual([
      ["a", "Outside"],
      ["b", "three spaces"],
    ]);
    expect(body).toContain("[^a]: in code");
    expect(body).not.toContain("Outside");
  });
});

describe("plain text import", () => {
  it("splits on blank lines and joins soft-wrapped lines", () => {
    expect(
      textToParagraphs("First line\nwraps here.\n\n  Second\tpara.  \r\n\r\n\r\nThird."),
    ).toEqual(["First line wraps here.", "Second para.", "Third."]);
  });

  it("makes each line a paragraph when there are no blank lines at all", () => {
    expect(textToParagraphs("\uFEFFOne\nTwo\r\nThree\n")).toEqual(["One", "Two", "Three"]);
  });

  it("makes a valid, empty document from an empty file", () => {
    const result = textToDocument("", "empty.txt");
    expect(result).toMatchObject({ title: "empty", plainText: "" });
    expect(result.content).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("keeps markup-looking text as text and titles the document from the file name", () => {
    const result = textToDocument("# Not a heading\n\n<b>not bold</b> & more", "notes.txt");
    expect(result.title).toBe("notes");
    expect(nodes(result.content, "heading")).toHaveLength(0);
    expect(result.plainText).toBe("# Not a heading\n\n<b>not bold</b> & more");
  });
});

describe("convertFile", () => {
  it("knows the formats by extension", () => {
    expect(importKind("A.DOCX")).toBe("docx");
    expect(importKind("notes.markdown")).toBe("markdown");
    expect(importKind("notes.md")).toBe("markdown");
    expect(importKind("x.txt")).toBe("text");
    expect(importKind("old.doc")).toBeNull();
    expect(importKind("page.html")).toBeNull();
    expect(importKind("README")).toBeNull();
  });

  it("refuses unsupported, too large, corrupt and binary files with a clear message", async () => {
    const fail = (file: File) =>
      convertFile(file).then(
        () => null,
        (e: unknown) => e,
      );
    const doc = await fail(new File(["x"], "old.doc"));
    expect(doc).toBeInstanceOf(ImportError);
    expect((doc as Error).message).toBe(IMPORT_ERRORS.unsupported("old.doc"));
    expect((doc as Error).message).toMatch(/save it as \.docx/);
    expect(((await fail(new File(["x"], "a.pdf"))) as Error).message).toMatch(/can import Word/);
    const big = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], "big.txt");
    expect(((await fail(big)) as Error).message).toBe(IMPORT_ERRORS.tooLarge);
    const corrupt = new File(["PK\u0003\u0004 definitely broken"], "essay.docx");
    expect(((await fail(corrupt)) as Error).message).toBe(IMPORT_ERRORS.corruptDocx);
    const binary = new File([new Uint8Array([72, 0, 105])], "x.txt");
    expect(((await fail(binary)) as Error).message).toBe(IMPORT_ERRORS.binary);
  });

  it("reads Markdown and reports progress", async () => {
    const stages: string[] = [];
    const result = await convertFile(new File(["# T\n\nBody."], "t.md"), (p) =>
      stages.push(p.stage),
    );
    expect(result.title).toBe("T");
    expect(result.plainText).toBe("Body.");
    expect(stages[0]).toBe("reading");
    expect(stages.at(-1)).toBe("converting");
  });

  it("decodes UTF-8, and Windows-1252 when the bytes are not UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("café").buffer as ArrayBuffer)).toBe("café");
    expect(decodeText(new Uint8Array([99, 97, 102, 0xe9]).buffer)).toBe("café");
  });
});
