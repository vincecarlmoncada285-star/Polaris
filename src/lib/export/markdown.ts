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

/** A textblock's inline content, ready to be written with its formatting. */
type Piece =
  /** Text with something besides whitespace, the whitespace at its edges, and its formatting. */
  | { kind: "text"; lead: string; core: string; trail: string; code: boolean; marks: OpenMark[] }
  /** Whitespace only: it goes outside any delimiters. */
  | { kind: "space"; text: string }
  /** A footnote reference: inside the formatting that carries on after it. */
  | { kind: "ref"; text: string }
  | { kind: "break" };

/** Formatting that would not be read back as written: `mark` is to be left off `piece`. */
interface Misread {
  /** The text piece: for a delimiter, the one its mark starts on (opening) or ends on (closing). */
  piece: number;
  mark: MarkName | "code";
}

/** Where a bold, italic or strikethrough delimiter was written, and for which text. */
interface Delimiter extends Misread {
  mark: Exclude<MarkName, "link">;
  at: number;
  length: number;
  char: string;
  role: "open" | "close";
  /** Inside another mark written with the same character ("*" for bold and italic). */
  nested: boolean;
}

/** The character before `i` (a whole code point, so an emoji is one), or "" at the start. */
function charBefore(s: string, i: number): string {
  if (i <= 0) return "";
  const low = s.charCodeAt(i - 1);
  return i >= 2 && low >= 0xdc00 && low <= 0xdfff ? s.slice(i - 2, i) : s[i - 1]!;
}

/** The character (a whole code point) at `i`, or "" at the end. */
const charAt = (s: string, i: number) =>
  i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : "";

/**
 * How CommonMark classes a character next to a delimiter run: the start or end of the line
 * counts as whitespace. GFM (and marked, the importer's parser) lets strikethrough sit right
 * inside bold or italic, so for "*" runs a "~" counts as an ordinary character.
 */
function charClass(c: string, run: string): "space" | "punct" | "other" {
  if (c === "" || /\s/u.test(c)) return "space";
  if (run === "*" && c === "~") return "other";
  return /[\p{P}\p{S}]/u.test(c) ? "punct" : "other";
}

/**
 * The text as the parser sees it around delimiters: an escaped character ("\*") is punctuation
 * whatever it is, so both of its characters read as "+".
 */
function maskEscapes(s: string): string {
  return s.replace(/\\[!-\/:-@[-`{-~]/g, "++");
}

/**
 * Renders the pieces with their formatting. Marks are opened and closed as a stack, so nested
 * formatting comes out as "**bold *both***"; a mark that lasts longer is opened outside one that
 * ends sooner, so neither has to be closed and opened again. Whitespace at the edge of formatted
 * text is moved outside the delimiters, where CommonMark needs it.
 */
function render(
  pieces: Piece[],
  breaks: boolean,
): { out: string; delimiters: Delimiter[]; misread: Misread | null } {
  let out = "";
  const delimiters: Delimiter[] = [];
  /** The marks open, outermost first: where each one's delimiter was written, and its last text. */
  const open: { mark: OpenMark; at: number; last: number }[] = [];
  let pendingSpace = "";
  let misread: Misread | null = null;
  // Where the last code span ended: one straight after it would merge with it ("`a``b`").
  let codeEnd = -1;

  const delimiter = (mark: MarkName, role: Delimiter["role"], piece: number) => {
    if (mark === "link") {
      // "!" right before a link would make it an image.
      if (out.endsWith("!")) out = `${out.slice(0, -1)}\\!`;
      out += "[";
      return;
    }
    const text = DELIMITERS[mark];
    const char = text[0]!;
    // A link's text is read on its own, so a mark outside the link does not count.
    let nested = false;
    for (let k = open.length - 1; k >= 0 && open[k]!.mark.name !== "link"; k--) {
      const outer = open[k]!;
      const name = outer.mark.name as Exclude<MarkName, "link">;
      if (DELIMITERS[name][0] !== char) continue;
      nested = true;
      // Opened together ("***"), then closed and opened again inside the other one: marked
      // pairs the "***" with the last closing run instead, and the middle is read as text.
      const together = outer.at + DELIMITERS[name].length;
      if (role === "open" && delimiters.some((d) => d.mark === mark && d.at === together)) {
        misread ??= { piece, mark };
      }
    }
    delimiters.push({ at: out.length, length: text.length, char, role, mark, piece, nested });
    out += text;
  };
  const closeTo = (depth: number) => {
    while (open.length > depth) {
      const { mark, last } = open.pop()!;
      if (mark.name === "link") out += `](${destination(mark.href!)})`;
      else delimiter(mark.name, "close", last);
    }
  };
  /** How many text pieces from `from` on carry `mark` without a break. */
  const extent = (mark: OpenMark, from: number) => {
    let n = 0;
    for (let j = from; j < pieces.length; j++) {
      const p = pieces[j]!;
      if (p.kind === "break") break;
      if (p.kind !== "text") continue;
      if (!p.marks.some((m) => sameMark(m, mark))) break;
      n++;
    }
    return n;
  };

  /** How many of the open marks (from the outside in) `want` keeps open. */
  const kept = (want: OpenMark[]) => {
    let keep = 0;
    while (keep < open.length && want.some((m) => sameMark(m, open[keep]!.mark))) keep++;
    return keep;
  };
  /** The marks of the next text piece after `i`, or none if a break or the end comes first. */
  const nextMarks = (i: number): OpenMark[] => {
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[j]!;
      if (p.kind === "break") return [];
      if (p.kind === "text") return p.marks;
    }
    return [];
  };

  pieces.forEach((piece, i) => {
    if (piece.kind === "space") {
      pendingSpace += piece.text;
    } else if (piece.kind === "ref") {
      // Inside the formatting that carries on after it: "**bold**[^1]", "**bold[^1] text**".
      closeTo(kept(nextMarks(i)));
      out += pendingSpace + piece.text;
      pendingSpace = "";
    } else if (piece.kind === "break") {
      // A backslash before the line break is CommonMark's hard break; a heading is one line.
      closeTo(0);
      out += pendingSpace + (breaks ? "\\\n" : " ");
      pendingSpace = "";
    } else {
      const want = piece.marks;
      closeTo(kept(want));
      out += pendingSpace + piece.lead;
      const opening = want
        .filter((m) => !open.some((o) => sameMark(o.mark, m)))
        .map((mark, order) => ({ mark, order, extent: extent(mark, i) }))
        .sort((a, b) => b.extent - a.extent || a.order - b.order);
      for (const { mark } of opening) {
        const at = out.length;
        delimiter(mark.name, "open", i);
        open.push({ mark, at, last: i });
      }
      for (const o of open) o.last = i;
      if (piece.code) {
        // marked does not find the end of a link's text past a code span with a backtick in it.
        const inLink = open.some((o) => o.mark.name === "link");
        if (out.length === codeEnd || (inLink && piece.core.includes("`"))) {
          misread ??= { piece: i, mark: "code" };
        }
        out += codeSpan(piece.core);
        codeEnd = out.length;
      } else {
        out += escapeMarkdown(piece.core);
      }
      pendingSpace = piece.trail;
    }
  });
  closeTo(0);
  out += pendingSpace;
  return { out, delimiters, misread };
}

/**
 * The first delimiter CommonMark would not read as the one intended: an opening run must be
 * left-flanking and a closing run right-flanking. "**Note:**text" is neither: the closing "**"
 * follows punctuation and a letter follows it, so it stays as two literal asterisks.
 */
function misreadDelimiter(out: string, delimiters: Delimiter[]): Delimiter | null {
  const masked = maskEscapes(out);
  for (let i = 0; i < delimiters.length; ) {
    // A run: delimiters of the same character written next to each other ("***").
    let j = i + 1;
    while (
      j < delimiters.length &&
      delimiters[j]!.char === delimiters[i]!.char &&
      delimiters[j]!.at === delimiters[j - 1]!.at + delimiters[j - 1]!.length
    ) {
      j++;
    }
    const run = delimiters.slice(i, j);
    const char = run[0]!.char;
    const start = run[0]!.at;
    const end = run.at(-1)!.at + run.at(-1)!.length;
    const after = charClass(charAt(masked, end), char);
    // marked reads the character before an opening run one UTF-16 unit at a time, so an emoji
    // there counts as an ordinary character; before a closing run it reads the whole character.
    const beforeOpen = charClass(masked[start - 1] ?? "", char);
    const beforeClose = charClass(charBefore(masked, start), char);
    const left = (before: string) => after !== "space" && (after !== "punct" || before !== "other");
    const right = (before: string) =>
      before !== "space" && (before !== "punct" || after !== "other");
    // A run that could both open and close (between two letters, or two punctuation marks):
    // inside another "*" mark, marked counts it as neither while looking for the outer mark's
    // end, so its partner throws the count out and the outer mark is not read at all.
    const either = left(beforeClose) && right(beforeClose);
    const bad = run.find(
      (d) => (d.role === "open" ? !left(beforeOpen) : !right(beforeClose)) || (either && d.nested),
    );
    if (bad) return bad;
    i = j;
  }
  return null;
}

/**
 * A textblock's inline content. Where formatting would not be read back as written (a delimiter
 * next to punctuation in a way CommonMark does not allow, two code spans in a row), that mark is
 * left off that stretch of text and the rest is written again: the formatting is lost there, but
 * the text comes back as it was (tests/unit/export.test.ts).
 */
function inline(nodes: DocNode[], notes: FootnoteCounter, { breaks = true } = {}): string {
  const pieces: Piece[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = node.text ?? "";
      const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
      if (!core) {
        pieces.push({ kind: "space", text });
        continue;
      }
      pieces.push({
        kind: "text",
        lead,
        core,
        trail,
        code: hasMark(node, "code"),
        marks: marksOf(node),
      });
    } else if (node.type === "hardBreak") {
      pieces.push({ kind: "break" });
    } else if (node.type === "footnote") {
      // Numbered once, here, in document order.
      pieces.push({ kind: "ref", text: `[^${notes.add(node)}]` });
    }
  }
  // A line break that ends the block would be read as a backslash: it goes, with the spaces
  // around it.
  while (pieces.length && ["break", "space"].includes(pieces.at(-1)!.kind)) pieces.pop();
  for (;;) {
    const { out, delimiters, misread } = render(pieces, breaks);
    const bad = misread ?? misreadDelimiter(out, delimiters);
    if (!bad) return out;
    const piece = pieces[bad.piece] as Extract<Piece, { kind: "text" }>;
    if (bad.mark === "code") piece.code = false;
    else piece.marks = piece.marks.filter((m) => m.name !== bad.mark);
  }
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
