// @vitest-environment jsdom
import { Editor, getExtensionField, getSchemaTypeByName } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";
import { documentExtensions } from "@/lib/editor/extensions";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  detectPlatform,
  isTextField,
  matchEditorShortcut,
  shortcutKeys,
  shortcutLabel,
  type KeyPress,
} from "@/lib/shortcuts";

/** Polaris's own, handled by the document page rather than by an editor keymap. */
const PAGE_SHORTCUTS = ["Alt-]", "Alt-[", "Escape", "Shift-?"];

/**
 * Keys every text editor has, which the dialog does not list as shortcuts: typing, deleting,
 * moving, select all, and aliases of listed ones (Caps Lock's Mod-B, a Cyrillic layout's Mod-я).
 */
const BASIC_EDITING = [
  "Enter",
  "Backspace",
  "Delete",
  "Mod-Backspace",
  "Shift-Backspace",
  "Mod-Delete",
  "Mod-a",
  "ArrowUp",
  "ArrowDown",
  "Mod-B",
  "Mod-I",
  "Mod-U",
  "Mod-я",
  "Shift-Mod-я",
];

/** Modifiers in any order: "Shift-Mod-z" and "Mod-Shift-z" are the same combination. */
const normalize = (combo: string) => {
  const parts = combo.split("-");
  const key = parts.pop()!;
  return [...parts.sort(), key].join("-");
};

function makeEditor(html = "<p>Hello world</p>") {
  const onEdit = vi.fn();
  const onLink = vi.fn();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: documentExtensions({ onEditFootnote: onEdit, onLinkShortcut: onLink }),
    content: html,
  });
  return { editor, onEdit, onLink };
}

/** Every key binding the editor's extensions register, as TipTap itself collects them. */
function editorBindings(editor: Editor): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const ext of editor.extensionManager.extensions) {
    const context = {
      name: ext.name,
      options: ext.options,
      storage: editor.extensionStorage[ext.name as never],
      editor,
      type: getSchemaTypeByName(ext.name, editor.schema),
    };
    const add = getExtensionField<() => Record<string, unknown>>(
      ext,
      "addKeyboardShortcuts",
      context,
    );
    for (const combo of Object.keys(add?.() ?? {})) bindings.set(normalize(combo), ext.name);
  }
  return bindings;
}

/** A keydown for `combo` on a non-Mac (where ProseMirror's Mod is Ctrl), through the editor. */
function press(editor: Editor, combo: string): boolean {
  const parts = combo.split("-");
  const key = parts.pop()!;
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: parts.includes("Mod") || parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    bubbles: true,
    cancelable: true,
  });
  return !!editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));
}

const at = (editor: Editor, text: string) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text))
      found = pos + node.text!.indexOf(text);
  });
  editor.commands.setTextSelection(found);
};

describe("the shortcut list", () => {
  it("lists every shortcut the editor has (and nothing it does not)", () => {
    const { editor } = makeEditor();
    const bound = editorBindings(editor);
    const listed = new Set(SHORTCUTS.flatMap((s) => s.keys).map(normalize));
    const basic = new Set(BASIC_EDITING.map(normalize));
    const unlisted = [...bound.keys()].filter((k) => !listed.has(k) && !basic.has(k));
    expect(unlisted).toEqual([]);
    const notBound = [...listed].filter(
      (k) => !bound.has(k) && !PAGE_SHORTCUTS.map(normalize).includes(k),
    );
    expect(notBound).toEqual([]);
    editor.destroy();
  });

  it("each listed editor shortcut really does something where it applies", () => {
    const cases: [string, (e: Editor) => void][] = [
      ["Mod-b", () => {}],
      ["Mod-i", () => {}],
      ["Mod-u", () => {}],
      ["Mod-Shift-s", () => {}],
      ["Mod-e", () => {}],
      ["Mod-Alt-1", () => {}],
      ["Mod-Alt-2", () => {}],
      ["Mod-Alt-3", () => {}],
      ["Mod-Alt-0", (e) => e.commands.setHeading({ level: 2 })],
      ["Mod-Shift-8", () => {}],
      ["Mod-Shift-7", () => {}],
      ["Mod-Shift-b", () => {}],
      ["Mod-Alt-c", () => {}],
      ["Shift-Enter", () => {}],
      ["Mod-Enter", () => {}],
      ["Mod-Alt-f", () => {}],
      ["Mod-k", () => {}],
      ["Mod-z", (e) => e.commands.insertContent("more ")],
      [
        "Mod-Shift-z",
        (e) => {
          e.commands.insertContent("more ");
          e.commands.undo();
        },
      ],
      [
        "Mod-y",
        (e) => {
          e.commands.insertContent("more ");
          e.commands.undo();
        },
      ],
    ];
    for (const [combo, setup] of cases) {
      const { editor } = makeEditor();
      at(editor, "world");
      setup(editor);
      expect(press(editor, combo), combo).toBe(true);
      editor.destroy();
    }
  });

  it("Tab and Shift-Tab indent and outdent a list item; Enter edits a selected footnote", () => {
    const { editor, onEdit } = makeEditor(
      '<ul><li><p>one</p></li><li><p>two</p></li></ul><p>Text<sup data-footnote data-content="A note.">1</sup></p>',
    );
    at(editor, "two");
    expect(press(editor, "Tab")).toBe(true);
    expect(editor.getHTML()).toContain("<li><p>one</p><ul><li><p>two</p></li></ul></li>");
    expect(press(editor, "Shift-Tab")).toBe(true);
    expect(editor.getHTML()).toContain("<li><p>one</p></li><li><p>two</p></li>");

    let marker = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "footnote") marker = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, marker)),
    );
    expect(press(editor, "Enter")).toBe(true);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ content: "A note." }));
    // Enter in ordinary text is still just Enter (a new paragraph), not the footnote dialog.
    onEdit.mockClear();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, marker - 1)),
    );
    press(editor, "Enter");
    expect(onEdit).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("puts every shortcut in a known group, each group used", () => {
    for (const s of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(s.group);
    for (const g of SHORTCUT_GROUPS) expect(SHORTCUTS.some((s) => s.group === g)).toBe(true);
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("modifier names", () => {
  it("uses Ctrl and Alt off a Mac, Cmd and Option on one, in the usual order", () => {
    expect(shortcutLabel("Mod-b", "other")).toBe("Ctrl+B");
    expect(shortcutLabel("Mod-b", "mac")).toBe("Cmd+B");
    expect(shortcutLabel("Mod-Alt-f", "other")).toBe("Ctrl+Alt+F");
    expect(shortcutLabel("Mod-Alt-f", "mac")).toBe("Cmd+Option+F");
    expect(shortcutLabel("Shift-Mod-z", "other")).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("Mod-Shift-8", "mac")).toBe("Cmd+Shift+8");
    expect(shortcutLabel("Alt-]", "mac")).toBe("Option+]");
    expect(shortcutKeys("Escape", "other")).toEqual(["Esc"]);
    expect(shortcutKeys("Shift-?", "other")).toEqual(["Shift", "?"]);
    expect(shortcutKeys("Shift-Enter", "mac")).toEqual(["Shift", "Enter"]);
  });

  it("detects a Mac the way ProseMirror does", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ platform: "iPhone" })).toBe("mac");
    expect(detectPlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0)" })).toBe(
      "mac",
    );
    expect(detectPlatform({ platform: "Win32" })).toBe("other");
    expect(detectPlatform({ platform: "Linux x86_64" })).toBe("other");
    expect(detectPlatform(undefined)).toBe("other");
  });
});

describe("matchEditorShortcut", () => {
  const key = (k: string, mods: Partial<KeyPress> = {}): KeyPress => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it("Alt+] and Alt+[ by character or by key position (Option+] on a Mac types ‘)", () => {
    expect(matchEditorShortcut(key("]", { altKey: true }), false)).toBe("next-suggestion");
    expect(matchEditorShortcut(key("[", { altKey: true }), true)).toBe("previous-suggestion");
    expect(matchEditorShortcut(key("‘", { altKey: true, code: "BracketRight" }), true)).toBe(
      "next-suggestion",
    );
    expect(matchEditorShortcut(key("“", { altKey: true, code: "BracketLeft" }), true)).toBe(
      "previous-suggestion",
    );
  });

  it("leaves brackets alone without Alt, with Ctrl (AltGr), Cmd or Shift", () => {
    expect(matchEditorShortcut(key("]", { code: "BracketRight" }), true)).toBeNull();
    expect(matchEditorShortcut(key("]", { altKey: true, ctrlKey: true }), true)).toBeNull();
    expect(matchEditorShortcut(key("]", { altKey: true, metaKey: true }), true)).toBeNull();
    expect(
      matchEditorShortcut(key("}", { altKey: true, shiftKey: true, code: "BracketRight" }), true),
    ).toBeNull();
  });

  it("Escape alone closes the open suggestion", () => {
    expect(matchEditorShortcut(key("Escape"), true)).toBe("close-suggestion");
    expect(matchEditorShortcut(key("Escape", { shiftKey: true }), true)).toBeNull();
    expect(matchEditorShortcut(key("Escape", { ctrlKey: true }), false)).toBeNull();
  });

  it("? opens the shortcuts only outside a text field", () => {
    expect(matchEditorShortcut(key("?", { shiftKey: true }), false)).toBe("show-shortcuts");
    expect(matchEditorShortcut(key("?", { shiftKey: true }), true)).toBeNull();
    expect(matchEditorShortcut(key("?", { shiftKey: true, ctrlKey: true }), false)).toBeNull();
    expect(matchEditorShortcut(key("/", { shiftKey: false }), false)).toBeNull();
  });

  it("ignores everything else", () => {
    for (const k of ["a", "Enter", "Tab", "ArrowDown", "]"]) {
      expect(matchEditorShortcut(key(k), false)).toBeNull();
    }
  });
});

describe("isTextField", () => {
  it("is true where keys type text", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    for (const el of [
      Object.assign(document.createElement("input"), { type: "text" }),
      Object.assign(document.createElement("input"), { type: "search" }),
      Object.assign(document.createElement("input"), { type: "number" }),
      document.createElement("textarea"),
      document.createElement("select"),
    ]) {
      expect(isTextField(el), el.outerHTML).toBe(true);
    }
    // jsdom has no isContentEditable; browsers do.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTextField(editable)).toBe(true);
    editable.remove();
  });

  it("is false for buttons, checkboxes and the page itself", () => {
    for (const el of [
      document.createElement("button"),
      Object.assign(document.createElement("input"), { type: "checkbox" }),
      Object.assign(document.createElement("input"), { type: "submit" }),
      document.createElement("div"),
      document.body,
      null,
    ]) {
      expect(isTextField(el)).toBe(false);
    }
  });
});
