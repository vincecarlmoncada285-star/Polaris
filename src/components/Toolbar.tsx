"use client";

import { useEditorState, type Editor } from "@tiptap/react";

interface Item {
  label: string;
  shortcut?: string;
  icon: string;
  isActive: (e: Editor) => boolean;
  run: (e: Editor) => void;
}

const ITEMS: (Item | "sep")[] = [
  {
    label: "Bold",
    shortcut: "Ctrl+B",
    icon: "B",
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: "Italic",
    shortcut: "Ctrl+I",
    icon: "I",
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: "Underline",
    shortcut: "Ctrl+U",
    icon: "U",
    isActive: (e) => e.isActive("underline"),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: "Superscript",
    shortcut: "Ctrl+.",
    icon: "x²",
    isActive: (e) => e.isActive("superscript"),
    run: (e) => e.chain().focus().toggleSuperscript().run(),
  },
  {
    label: "Subscript",
    shortcut: "Ctrl+,",
    icon: "x₂",
    isActive: (e) => e.isActive("subscript"),
    run: (e) => e.chain().focus().toggleSubscript().run(),
  },
  "sep",
  {
    label: "Heading 1",
    icon: "H1",
    isActive: (e) => e.isActive("heading", { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    icon: "H2",
    isActive: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    icon: "H3",
    isActive: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  "sep",
  {
    label: "Bulleted list",
    icon: "•",
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered list",
    icon: "1.",
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Block quote",
    icon: "❝",
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

export function Toolbar({
  editor,
  onLink,
  onFootnote,
}: {
  editor: Editor;
  /** Opens the link dialog for the selection (also Ctrl+K in the text). */
  onLink: () => void;
  /** Inserts a footnote at the cursor and opens its dialog (also Ctrl+Alt+F). */
  onFootnote: () => void;
}) {
  // TipTap 3 does not re-render on every transaction, so subscribe to the pressed states
  // (they change when the cursor moves into bold text, not only when the text changes).
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ITEMS.map((item) => (item === "sep" ? false : item.isActive(e))),
  });
  const inLink = useEditorState({ editor, selector: ({ editor: e }) => e.isActive("link") });
  const dialogButton = (on: boolean) =>
    `rounded px-1.5 py-1 text-sm font-medium ${
      on ? "bg-accent-soft text-accent" : "text-muted hover:bg-background hover:text-foreground"
    }`;
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1"
    >
      {ITEMS.map((item, i) =>
        item === "sep" ? (
          <span key={i} aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
            aria-label={item.label}
            aria-pressed={active[i]}
            onClick={() => item.run(editor)}
            className={`min-w-7 rounded px-1.5 py-1 text-sm font-medium ${
              active[i]
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-background hover:text-foreground"
            } ${item.icon === "I" ? "italic" : ""} ${item.icon === "U" ? "underline" : ""}`}
          >
            {item.icon}
          </button>
        ),
      )}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      {/* These open dialogs rather than toggling, so they are not pressed buttons. */}
      <button
        type="button"
        title="Link (Ctrl+K)"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={onLink}
        className={`${dialogButton(inLink)} underline`}
      >
        Link
      </button>
      <button
        type="button"
        title="Footnote (Ctrl+Alt+F)"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+Alt+F Meta+Alt+F"
        onClick={onFootnote}
        className={dialogButton(false)}
      >
        Footnote
      </button>
    </div>
  );
}
