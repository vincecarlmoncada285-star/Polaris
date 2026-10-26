// Markdown → HTML for htmlToDocument(): GitHub-flavoured Markdown (marked), with footnotes
// ([^label] references and [^label]: definitions) turned into Polaris footnotes. Raw HTML in the
// Markdown is not trusted: it is shown as the text it is, never parsed as markup.
import { Marked, type Tokens } from "marked";
import { escapeHtml, htmlToDocument, type ImportedDocument } from "./html";

const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A line that starts a block of its own, so it cannot continue a definition's paragraph. */
const BLOCK_START = /^ {0,3}(?:[#>|]|[-*+][ \t]|\d{1,9}[.)][ \t]|(?:[-*_][ \t]*){3,}$|`{3,}|~{3,})/;

/**
 * Takes footnote definitions out of the Markdown (outside code fences), with their continuation
 * lines: indented ones, and, as for any Markdown paragraph, unindented ones that follow
 * directly (a definition hard-wrapped by an editor). Returns the rest of the source and the
 * definitions by label.
 */
export function extractFootnoteDefinitions(source: string): {
  body: string;
  definitions: Map<string, string>;
} {
  const lines = source.split("\n");
  const kept: string[] = [];
  const definitions = new Map<string, string>();
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) {
        fence = null;
      }
      kept.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!;
      kept.push(line);
      continue;
    }
    const def = DEFINITION.exec(line);
    if (!def) {
      kept.push(line);
      continue;
    }
    const parts = [def[2]!];
    // Continuation: indented lines, possibly after blank lines, and lazy ones (any line that
    // follows without a blank line and does not start a block or another definition).
    while (i + 1 < lines.length) {
      const next = lines[i + 1]!;
      const lazy = next.trim() !== "" && !BLOCK_START.test(next) && !DEFINITION.test(next);
      if (/^( {4}|\t)/.test(next) || lazy) {
        parts.push(next.trim());
        i++;
      } else if (next.trim() === "" && /^( {4}|\t)\S/.test(lines[i + 2] ?? "")) {
        i++;
      } else {
        break;
      }
    }
    const label = def[1]!.toLowerCase();
    if (!definitions.has(label)) definitions.set(label, parts.join(" ").trim());
  }
  return { body: kept.join("\n"), definitions };
}

function createMarked(definitions: Map<string, string>, footnoteText: (md: string) => string) {
  const marked = new Marked({ gfm: true, breaks: false, async: false });
  marked.use({
    renderer: {
      // Raw HTML, block or inline, becomes visible text (a block of it, a paragraph).
      html({ text, block }: Tokens.HTML | Tokens.Tag) {
        return block ? `<p>${escapeHtml(text.trim())}</p>` : escapeHtml(text);
      },
    },
    extensions: [
      {
        name: "footnoteRef",
        level: "inline",
        start(src: string) {
          const i = src.indexOf("[^");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string) {
          const m = /^\[\^([^\]\s]+)\]/.exec(src);
          // A reference without a definition stays as the text it is.
          if (!m || !definitions.has(m[1]!.toLowerCase())) return undefined;
          return { type: "footnoteRef", raw: m[0], label: m[1]!.toLowerCase() };
        },
        renderer(token) {
          const content = footnoteText(definitions.get(String(token.label)) ?? "");
          return `<sup data-footnote="" data-content="${escapeHtml(content)}"></sup>`;
        },
      },
    ],
  });
  return marked;
}

/** Markdown as HTML, footnote references as <sup data-footnote data-content> markers. */
export function markdownToHtml(source: string): string {
  const { body, definitions } = extractFootnoteDefinitions(source.replace(/\r\n?/g, "\n"));
  // A definition is Markdown too ("*Ibid.*, p. 4"); a footnote keeps only its text.
  const plain = createMarked(new Map(), () => "");
  const footnoteText = (md: string) =>
    new DOMParser().parseFromString(plain.parseInline(md) as string, "text/html").body
      .textContent ?? "";
  return createMarked(definitions, footnoteText).parse(body) as string;
}

export function markdownToDocument(source: string, fileName: string): ImportedDocument {
  return htmlToDocument(markdownToHtml(source.replace(/^\uFEFF/, "")), { fileName });
}
