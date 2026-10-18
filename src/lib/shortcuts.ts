// Every keyboard shortcut in the editor, in one list: the Keyboard shortcuts dialog shows it, and
// the editor's own shortcuts (next / previous suggestion, closing a card, opening the dialog) are
// matched here. Most of the rest are TipTap's (StarterKit) and Polaris's editor extensions;
// tests/unit/shortcuts.test.ts checks this list against the keymaps the editor really has.

export type ShortcutGroup =
  | "Formatting"
  | "Paragraphs"
  | "Editing"
  | "Notes and links"
  | "Suggestions"
  | "Help";

export interface Shortcut {
  /** Key combinations in ProseMirror's notation ("Mod-b", "Shift-Mod-z", "Alt-]"): any of them. */
  keys: readonly string[];
  action: string;
  group: ShortcutGroup;
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  "Formatting",
  "Paragraphs",
  "Editing",
  "Notes and links",
  "Suggestions",
  "Help",
];

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ["Mod-b"], action: "Bold", group: "Formatting" },
  { keys: ["Mod-i"], action: "Italic", group: "Formatting" },
  { keys: ["Mod-u"], action: "Underline", group: "Formatting" },
  { keys: ["Mod-Shift-s"], action: "Strikethrough", group: "Formatting" },
  { keys: ["Mod-e"], action: "Inline code", group: "Formatting" },

  { keys: ["Mod-Alt-1"], action: "Heading 1", group: "Paragraphs" },
  { keys: ["Mod-Alt-2"], action: "Heading 2", group: "Paragraphs" },
  { keys: ["Mod-Alt-3"], action: "Heading 3", group: "Paragraphs" },
  { keys: ["Mod-Alt-0"], action: "Normal paragraph", group: "Paragraphs" },
  { keys: ["Mod-Shift-8"], action: "Bulleted list", group: "Paragraphs" },
  { keys: ["Mod-Shift-7"], action: "Numbered list", group: "Paragraphs" },
  { keys: ["Tab"], action: "Indent a list item", group: "Paragraphs" },
  { keys: ["Shift-Tab"], action: "Outdent a list item", group: "Paragraphs" },
  { keys: ["Mod-Shift-b"], action: "Block quote", group: "Paragraphs" },
  { keys: ["Mod-Alt-c"], action: "Code block", group: "Paragraphs" },

  { keys: ["Mod-z"], action: "Undo", group: "Editing" },
  { keys: ["Mod-Shift-z", "Mod-y"], action: "Redo", group: "Editing" },
  { keys: ["Shift-Enter", "Mod-Enter"], action: "Line break", group: "Editing" },

  { keys: ["Mod-k"], action: "Add or edit a link", group: "Notes and links" },
  { keys: ["Mod-Alt-f"], action: "Add a footnote", group: "Notes and links" },
  { keys: ["Enter"], action: "Edit the selected footnote marker", group: "Notes and links" },

  { keys: ["Alt-]"], action: "Next suggestion", group: "Suggestions" },
  { keys: ["Alt-["], action: "Previous suggestion", group: "Suggestions" },
  {
    keys: ["Escape"],
    action: "Close the open suggestion and return to the text",
    group: "Suggestions",
  },

  { keys: ["Shift-?"], action: "Show keyboard shortcuts (outside a text field)", group: "Help" },
];

export type Platform = "mac" | "other";

/** Like ProseMirror's own test, so the names shown are the keys its "Mod" really means. */
export function detectPlatform(
  nav: { platform?: string; userAgent?: string } | undefined,
): Platform {
  const id = nav?.platform || nav?.userAgent || "";
  return /Mac|iP(hone|[oa]d)/.test(id) ? "mac" : "other";
}

const NAMES: Record<Platform, Record<string, string>> = {
  mac: { Mod: "Cmd", Alt: "Option", Shift: "Shift", Ctrl: "Control" },
  other: { Mod: "Ctrl", Alt: "Alt", Shift: "Shift", Ctrl: "Ctrl" },
};

// Modifiers in the usual order: Ctrl (Cmd on a Mac), then Alt (Option), then Shift.
const MODIFIER_ORDER: Record<string, number> = { Mod: 0, Ctrl: 0, Alt: 1, Shift: 2 };

/**
 * One combination as the keys to press: "Mod-Alt-1" is ["Ctrl", "Alt", "1"] (["Cmd", "Option",
 * "1"] on a Mac), and "Shift-Mod-z" is ["Ctrl", "Shift", "Z"].
 */
export function shortcutKeys(combo: string, platform: Platform): string[] {
  // The last part is the key itself, which may be "-" (not used today, but keep it safe).
  const parts = combo.endsWith("--") ? [...combo.slice(0, -2).split("-"), "-"] : combo.split("-");
  const key = parts.pop()!;
  const modifiers = parts
    .sort((a, b) => (MODIFIER_ORDER[a] ?? 3) - (MODIFIER_ORDER[b] ?? 3))
    .map((m) => NAMES[platform][m] ?? m);
  const shown = key.length === 1 ? key.toUpperCase() : key === "Escape" ? "Esc" : key;
  return [...modifiers, shown];
}

/** "Ctrl+Alt+1": a combination as text, for a title attribute or a screen reader. */
export function shortcutLabel(combo: string, platform: Platform): string {
  return shortcutKeys(combo, platform).join("+");
}

export type EditorCommand =
  | "next-suggestion"
  | "previous-suggestion"
  | "close-suggestion"
  | "show-shortcuts";

/** What `matchEditorShortcut` needs of a keydown event. */
export interface KeyPress {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const BRACKET_COMMANDS: Record<string, EditorCommand> = {
  BracketRight: "next-suggestion",
  BracketLeft: "previous-suggestion",
};

/**
 * The editor command a key press asks for, if any.
 *
 * Alt+] and Alt+[ are the keys right of P, matched by position (`code`), not by the character
 * typed: on a US Mac, Option+] types "‘", so `key` is not "]". The character is read only when
 * the browser gives no position. Never a key that types a bracket, which a writer needs for
 * "[1]" or "[sic]": Ctrl must be up, so AltGr (Ctrl+Alt on Windows) still types them, and on a
 * Mac, where Option types characters, an Option press that types "[" or "]" is left alone
 * (Option+5 on a German Mac, which is not at that position anyway; Option and the key right of
 * P on a Spanish one, which is).
 *
 * Shift+? only counts outside a text field, where "?" would be typed.
 */
export function matchEditorShortcut(
  e: KeyPress,
  inTextField: boolean,
  platform: Platform,
): EditorCommand | null {
  const noCtrlMeta = !e.ctrlKey && !e.metaKey;
  if (e.altKey && noCtrlMeta && !e.shiftKey) {
    const typesBracket = e.key === "[" || e.key === "]";
    if (!(platform === "mac" && typesBracket)) {
      const position =
        e.code || (e.key === "]" ? "BracketRight" : e.key === "[" ? "BracketLeft" : "");
      const command = BRACKET_COMMANDS[position];
      if (command) return command;
    }
  }
  if (e.key === "Escape" && noCtrlMeta && !e.altKey && !e.shiftKey) return "close-suggestion";
  if (e.key === "?" && noCtrlMeta && !e.altKey && !inTextField) return "show-shortcuts";
  return null;
}

/** Whether keys typed into `el` are text: inputs, text areas, selects and editable content. */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return ![
    "button",
    "checkbox",
    "radio",
    "range",
    "color",
    "file",
    "image",
    "reset",
    "submit",
  ].includes(type);
}
