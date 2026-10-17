// TipTap JSON → CommonMark (with GFM strikethrough and footnotes as [^n] references and
// definitions at the end). Pure. Everything the writer typed is escaped, so it comes back as
// text: importing the file again gives the same text (tests/unit/export.test.ts).
import {
  FootnoteCounter,
  childrenOf,
  hasMark,
  headingLevel,
  linkOf,
  listStart,
  type DocNode,
} from "./json";

/** Inline formatting Markdown can express, outermost first. Underline has no Markdown. */
const MARKS = ["link", "bold", "italic", "strike"] as const;
type MarkName = (typeof MARKS)[number];
interface OpenMark {
  name: MarkName;
  href?: string;
}

const DELIMITERS: Record<Exclude<MarkName, "link">, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
};

const isAlnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/**
 * Escapes text so no character in it is read as Markdown: backslash, emphasis and code
 * characters, brackets (links, footnote references), "<" (HTML, autolinks), "~" (GFM
 * strikethrough), "|" (GFM tables) and an "&" that would start an entity. An "_" inside a
 * word cannot start emphasis, so it is left alone ("snake_case").
 */
export function escapeMarkdown(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "_" && isAlnum(text[i - 1]) && isAlnum(text[i + 1])) out += c;
    else if ("\\`*_[]<~|".includes(c)) out += `\\${c}`;
    else if (c === "&" && /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i.test(text.slice(i))) out += "\\&";
    else out += c;
  }
  return out;
}

/**
 * Escapes what only means something at the start of a line: headings, quotes, list markers,
 * setext underlines and thematic breaks, and a footnote reference followed by ":" (which would
 * read as a definition).
 */
function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        // Spaces at the start of a line mean nothing in a paragraph, except that four of them
        // start a code block: they go.
        .replace(/^[ \t]+/, "")
        .replace(/^([#>+=-])/, "\\$1")
        .replace(/^(\d+)([.)])/, "$1\\$2")
        .replace(/^(\[\^\d+\]):/, "$1\\:"),
    )
    .join("\n");
}

/** A code span whose fence is longer than any run of backticks inside it. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A link destination: in angle brackets when it has spaces or parentheses. */
function destination(href: string): string {
  if (!/[\s()<>]/.test(href)) return href;
  return `<${href.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\s/g, "%20")}>`;
}

function marksOf(node: DocNode): OpenMark[] {
  const marks: OpenMark[] = [];
  for (const name of MARKS) {
    if (name === "link") {
      const href = linkOf(node);
      if (href) marks.push({ name, href });
    } else if (hasMark(node, name)) {
      marks.push({ name });
    }
  }
  return marks;
}

const sameMark = (a: OpenMark, b: OpenMark) => a.name === b.name && a.href === b.href;

/**
 * A textblock's inline content. Marks are opened and closed as a stack, so nested formatting
 * comes out as "**bold *both***"; whitespace at the edge of formatted text is moved outside
 * the delimiters, where CommonMark needs it.
 */
function inline(nodes: DocNode[], notes: FootnoteCounter, { breaks = true } = {}): string {
  let out = "";
  const open: OpenMark[] = [];
  let pendingSpace = "";
  const closeTo = (depth: number) => {
    while (open.length > depth) {
      const mark = open.pop()!;
      out += mark.name === "link" ? `](${destination(mark.href!)})` : DELIMITERS[mark.name];
    }
  };
  const transition = (want: OpenMark[], lead: string) => {
    let keep = 0;
    while (keep < open.length && keep < want.length && sameMark(open[keep]!, want[keep]!)) keep++;
    closeTo(keep);
    out += pendingSpace + lead;
    pendingSpace = "";
    for (const mark of want.slice(keep)) {
      out += mark.name === "link" ? "[" : DELIMITERS[mark.name];
      open.push(mark);
    }
  };

  for (const node of nodes) {
    if (node.type === "text") {
      const text = node.text ?? "";
      const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
      if (!core) {
        pendingSpace += text;
        continue;
      }
      transition(marksOf(node), lead);
      out += hasMark(node, "code") ? codeSpan(core) : escapeMarkdown(core);
      pendingSpace = trail;
    } else if (node.type === "hardBreak") {
      // A backslash before the line break is CommonMark's hard break; a heading is one line.
      transition([], "");
      out += breaks ? "\\\n" : " ";
    } else if (node.type === "footnote") {
      transition(open.slice(), "");
      out += `[^${notes.add(node)}]`;
    }
  }
  closeTo(0);
  out += pendingSpace;
  return out;
}

const indent = (text: string, prefix: string, first = prefix) =>
  text
    .split("\n")
    .map((line, i) => (line === "" ? "" : (i === 0 ? first : prefix) + line))
    .join("\n");

function fencedCode(node: DocNode): string {
  const text = childrenOf(node)
    .map((c) => c.text ?? "")
    .join("");
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
  return `${fence}${language.replace(/[^\w+-]/g, "")}\n${text}\n${fence}`;
}

function listItems(node: DocNode, notes: FootnoteCounter, ordered: boolean): string {
  const start = listStart(node);
  return childrenOf(node)
    .map((item, i) => {
      const marker = ordered ? `${start + i}. ` : "- ";
      const parts = childrenOf(item).map((child) => ({ child, text: block(child, notes) }));
      let body = "";
      parts.forEach(({ child, text }, j) => {
        if (j > 0) {
          // A nested list follows its paragraph directly; another paragraph needs a blank line.
          body += child.type === "bulletList" || child.type === "orderedList" ? "\n" : "\n\n";
        }
        body += text;
      });
      return indent(body || "", " ".repeat(marker.length), marker) || marker.trimEnd();
    })
    .join("\n");
}

function block(node: DocNode, notes: FootnoteCounter): string {
  switch (node.type) {
    case "paragraph":
      return escapeLineStarts(inline(childrenOf(node), notes));
    case "heading": {
      const text = inline(childrenOf(node), notes, { breaks: false }).replace(/#+\s*$/, (m) =>
        m.replace(/#/g, "\\#"),
      );
      return `${"#".repeat(headingLevel(node))} ${text}`.trimEnd();
    }
    case "blockquote":
      return indent(blocks(childrenOf(node), notes), "> ")
        .split("\n")
        .map((line) => line || ">")
        .join("\n");
    case "bulletList":
      return listItems(node, notes, false);
    case "orderedList":
      return listItems(node, notes, true);
    case "codeBlock":
      return fencedCode(node);
    case "horizontalRule":
      return "---";
    default:
      // Anything else (from a newer version, say) keeps its text.
      return childrenOf(node).length ? blocks(childrenOf(node), notes) : "";
  }
}

function blocks(nodes: DocNode[], notes: FootnoteCounter): string {
  return nodes
    .map((n) => block(n, notes))
    .filter((text) => text !== "")
    .join("\n\n");
}

/**
 * The document as Markdown: the title as a level-1 heading (when there is one), the body, then
 * the footnotes' definitions in order.
 */
export function toMarkdown(doc: DocNode, title = ""): string {
  const notes = new FootnoteCounter();
  const parts: string[] = [];
  if (title.trim()) {
    parts.push(`# ${escapeMarkdown(title.trim()).replace(/#+$/, (m) => m.replace(/#/g, "\\#"))}`);
  }
  const body = blocks(childrenOf(doc), notes);
  if (body) parts.push(body);
  if (notes.notes.length) {
    parts.push(notes.notes.map((text, i) => `[^${i + 1}]: ${escapeMarkdown(text)}`).join("\n"));
  }
  return `${parts.join("\n\n")}\n`;
}
