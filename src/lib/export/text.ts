// TipTap JSON → plain text. Pure. Paragraphs are separated by blank lines, list markers are
// kept, quotes are indented, and footnotes become [1] in the text and a numbered list at the end.
import { FootnoteCounter, childrenOf, listStart, type DocNode } from "./json";

function inline(nodes: DocNode[], notes: FootnoteCounter): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.text ?? "";
    else if (node.type === "hardBreak") out += "\n";
    else if (node.type === "footnote") out += `[${notes.add(node)}]`;
  }
  return out;
}

const indent = (text: string, prefix: string, first = prefix) =>
  text
    .split("\n")
    .map((line, i) => (line === "" ? "" : (i === 0 ? first : prefix) + line))
    .join("\n");

function list(node: DocNode, notes: FootnoteCounter, ordered: boolean): string {
  const start = listStart(node);
  return childrenOf(node)
    .map((item, i) => {
      const marker = ordered ? `${start + i}. ` : "- ";
      const body = childrenOf(item)
        .map((child) => block(child, notes))
        .join("\n");
      return indent(body, " ".repeat(marker.length), marker) || marker.trimEnd();
    })
    .join("\n");
}

function block(node: DocNode, notes: FootnoteCounter): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return inline(childrenOf(node), notes);
    case "blockquote":
      return indent(blocks(childrenOf(node), notes), "    ");
    case "bulletList":
      return list(node, notes, false);
    case "orderedList":
      return list(node, notes, true);
    case "codeBlock":
      return childrenOf(node)
        .map((c) => c.text ?? "")
        .join("");
    case "horizontalRule":
      return "* * *";
    default:
      return blocks(childrenOf(node), notes);
  }
}

function blocks(nodes: DocNode[], notes: FootnoteCounter): string {
  return nodes
    .map((n) => block(n, notes))
    .filter((t) => t.trim() !== "")
    .join("\n\n");
}

/** The document as plain text: title, body, then "Footnotes" and a numbered list. */
export function toPlainText(doc: DocNode, title = ""): string {
  const notes = new FootnoteCounter();
  const parts: string[] = [];
  if (title.trim()) parts.push(title.trim());
  const body = blocks(childrenOf(doc), notes);
  if (body) parts.push(body);
  if (notes.notes.length) {
    parts.push(`Footnotes\n\n${notes.notes.map((t, i) => `${i + 1}. ${t}`).join("\n")}`);
  }
  return `${parts.join("\n\n")}\n`;
}
