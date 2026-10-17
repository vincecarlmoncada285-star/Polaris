// TipTap JSON → a Word document (docx). Loaded only when the writer exports to Word, so the
// docx package stays out of the editor's bundle. buildDocx() is pure; the packer turns it into
// a file (a Blob in the browser, a Buffer in Node for the tests).
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import {
  FootnoteCounter,
  childrenOf,
  hasMark,
  headingLevel,
  linkOf,
  listStart,
  type DocNode,
} from "./json";

/** A readable default for coursework: 12 pt serif, 1.5 line spacing. */
const FONT = "Times New Roman";
const BODY_SIZE = 24; // half-points
const LINE_150 = 360; // 240ths of a line
const CODE_FONT = "Courier New";
const QUOTE_STYLE = "PolarisQuote";
const INDENT = 720; // twips: half an inch

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

const BULLETS = "polaris-bullets";
const BULLET_SYMBOLS = ["•", "◦", "▪"];
const NUMBER_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

const levelIndent = (level: number) => ({ left: INDENT * (level + 1), hanging: 360 });

const bulletLevels = Array.from({ length: 9 }, (_, level) => ({
  level,
  format: LevelFormat.BULLET,
  text: BULLET_SYMBOLS[level % BULLET_SYMBOLS.length]!,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: levelIndent(level) } },
}));

const numberLevels = (start: number) =>
  Array.from({ length: 9 }, (_, level) => ({
    level,
    format: NUMBER_FORMATS[level % NUMBER_FORMATS.length]!,
    text: `%${level + 1}.`,
    start: level === 0 ? start : 1,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: levelIndent(level) } },
  }));

interface Context {
  notes: FootnoteCounter;
  /** Nesting of the lists around a paragraph: each one's numbering reference and instance. */
  lists: { ordered: boolean; reference: string; instance: number }[];
  quoteDepth: number;
  /** The paragraph continues a list item (its second paragraph): indented, not numbered. */
  continuation: boolean;
  /** Every numbered list gets its own numbering, so each one starts again from its start. */
  nextList: { n: number };
}

function runs(nodes: DocNode[], ctx: Context): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  // Consecutive text with the same link goes into one hyperlink.
  let link: { href: string; children: ParagraphChild[] } | null = null;
  const flush = () => {
    if (link) out.push(new ExternalHyperlink({ link: link.href, children: link.children }));
    link = null;
  };
  for (const node of nodes) {
    let run: ParagraphChild | null = null;
    const href = node.type === "text" ? linkOf(node) : null;
    if (node.type === "text") {
      const code = hasMark(node, "code");
      run = new TextRun({
        text: node.text ?? "",
        bold: hasMark(node, "bold") || undefined,
        italics: hasMark(node, "italic") || undefined,
        underline: hasMark(node, "underline") ? {} : undefined,
        strike: hasMark(node, "strike") || undefined,
        font: code ? CODE_FONT : undefined,
        style: href ? "Hyperlink" : undefined,
      });
    } else if (node.type === "hardBreak") {
      run = new TextRun({ text: "", break: 1 });
    } else if (node.type === "footnote") {
      run = new FootnoteReferenceRun(ctx.notes.add(node));
    }
    if (!run) continue;
    if (href) {
      if (link && (link as { href: string }).href !== href) flush();
      link ??= { href, children: [] };
      link.children.push(run);
    } else {
      flush();
      out.push(run);
    }
  }
  flush();
  return out;
}

/** Paragraph options that place a paragraph in the lists and quotes around it. */
function placement(ctx: Context): Partial<IParagraphOptions> {
  const list = ctx.lists.at(-1);
  const options: { -readonly [K in keyof IParagraphOptions]?: IParagraphOptions[K] } = {};
  if (list && ctx.continuation) {
    options.indent = { left: INDENT * ctx.lists.length };
  } else if (list) {
    options.numbering = {
      reference: list.reference,
      level: Math.min(ctx.lists.length - 1, 8),
      instance: list.instance,
    };
  }
  if (ctx.quoteDepth > 0) {
    options.style = QUOTE_STYLE;
    if (ctx.quoteDepth > 1 || list) {
      options.indent = { left: INDENT * (ctx.quoteDepth + ctx.lists.length) };
    }
  }
  return options;
}

function blocks(nodes: DocNode[], ctx: Context): Paragraph[] {
  return nodes.flatMap((node) => block(node, ctx));
}

function list(node: DocNode, ctx: Context, ordered: boolean): Paragraph[] {
  const reference = ordered ? `polaris-numbers-${listStart(node)}` : BULLETS;
  const instance = ordered ? ++ctx.nextList.n : 0;
  const out: Paragraph[] = [];
  for (const item of childrenOf(node)) {
    ctx.lists.push({ ordered, reference, instance });
    childrenOf(item).forEach((child, i) => {
      // A second paragraph in an item gets no number of its own, just the item's indent.
      const continuation = i > 0 && child.type !== "bulletList" && child.type !== "orderedList";
      ctx.continuation = continuation;
      out.push(...block(child, ctx));
      ctx.continuation = false;
    });
    ctx.lists.pop();
  }
  return out;
}

function block(node: DocNode, ctx: Context): Paragraph[] {
  switch (node.type) {
    case "paragraph":
      return [new Paragraph({ children: runs(childrenOf(node), ctx), ...placement(ctx) })];
    case "heading":
      return [
        new Paragraph({
          heading: HEADINGS[headingLevel(node) - 1],
          children: runs(childrenOf(node), ctx),
        }),
      ];
    case "blockquote": {
      ctx.quoteDepth++;
      const out = blocks(childrenOf(node), ctx);
      ctx.quoteDepth--;
      return out;
    }
    case "bulletList":
      return list(node, ctx, false);
    case "orderedList":
      return list(node, ctx, true);
    case "codeBlock": {
      const lines = childrenOf(node)
        .map((c) => c.text ?? "")
        .join("")
        .split("\n");
      return [
        new Paragraph({
          ...placement(ctx),
          spacing: { line: 240 },
          children: lines.map(
            (line, i) => new TextRun({ text: line, font: CODE_FONT, break: i > 0 ? 1 : undefined }),
          ),
        }),
      ];
    }
    case "horizontalRule":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } },
        }),
      ];
    default:
      return blocks(childrenOf(node), ctx);
  }
}

/** Every distinct ordered-list start in the document, so each gets a numbering definition. */
function listStarts(node: DocNode, found = new Set<number>()): Set<number> {
  if (node.type === "orderedList") found.add(listStart(node));
  for (const child of childrenOf(node)) listStarts(child, found);
  return found;
}

/** The document as a Word file's object model: title, headings, lists, links, footnotes. */
export function buildDocx(doc: DocNode, title = ""): Document {
  const ctx: Context = {
    notes: new FootnoteCounter(),
    lists: [],
    quoteDepth: 0,
    continuation: false,
    nextList: { n: 0 },
  };
  const body = blocks(childrenOf(doc), ctx);
  const children = title.trim()
    ? [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title.trim())] }),
        ...body,
      ]
    : body;
  const heading = (size: number) => ({ run: { font: FONT, size, bold: true, color: "000000" } });
  return new Document({
    title: title.trim() || undefined,
    creator: "Polaris",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE },
          paragraph: { spacing: { line: LINE_150 } },
        },
        title: { run: { font: FONT, size: 40, bold: true, color: "000000" } },
        heading1: heading(32),
        heading2: heading(28),
        heading3: heading(26),
      },
      paragraphStyles: [
        {
          id: QUOTE_STYLE,
          name: "Quote",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { italics: true },
          paragraph: { indent: { left: INDENT, right: INDENT } },
        },
      ],
    },
    numbering: {
      config: [
        { reference: BULLETS, levels: bulletLevels },
        ...[...listStarts(doc)].map((start) => ({
          reference: `polaris-numbers-${start}`,
          levels: numberLevels(start),
        })),
      ],
    },
    footnotes: Object.fromEntries(
      ctx.notes.notes.map((text, i) => [
        i + 1,
        { children: [new Paragraph({ children: [new TextRun(text)] })] },
      ]),
    ),
    sections: [{ children }],
  });
}

/** The Word file, in the browser. */
export function exportDocx(doc: DocNode, title = ""): Promise<Blob> {
  return Packer.toBlob(buildDocx(doc, title));
}
