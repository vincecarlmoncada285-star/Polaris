// The editor's schema in one place: the document editor, the importer (which parses HTML with
// exactly this schema, so whatever the editor cannot show is dropped) and the tests use this
// list. The editor adds its UI-only extensions (placeholder, suggestions) on top.
import { Extension, type AnyExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Footnote, type FootnoteTarget } from "./footnote";
import { isAllowedLinkHref, isAllowedLinkUri } from "./links";

/** Every link opens in a new tab, and passes on nothing about Polaris or the writer. */
export const LINK_ATTRIBUTES = { rel: "noopener noreferrer nofollow", target: "_blank" } as const;

export interface DocumentExtensionOptions {
  /** A footnote marker was clicked, or Enter pressed on it, or one was inserted by shortcut. */
  onEditFootnote?: (target: FootnoteTarget) => void;
  /** Mod-k: the writer wants the link dialog. */
  onLinkShortcut?: () => void;
}

interface LinkBehaviourOptions {
  onShortcut: (() => void) | null;
}

/**
 * Links in the editor: a plain click places the cursor (so the writer can edit the link text),
 * Ctrl or Cmd and click opens the link in a new tab, and Mod-k opens the link dialog.
 */
const LinkBehaviour = Extension.create<LinkBehaviourOptions>({
  name: "linkBehaviour",

  addOptions() {
    return { onShortcut: null };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.options.onShortcut?.();
        return this.options.onShortcut !== null;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("polaris-link-open"),
        props: {
          handleClick(view, _pos, event) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
            const target = event.target as HTMLElement | null;
            const anchor = target?.closest?.("a[href]");
            // Footnote markers are links too, to their entry; they are not opened.
            if (!anchor || !view.dom.contains(anchor) || anchor.closest("[data-footnote]")) {
              return false;
            }
            const href = anchor.getAttribute("href") ?? "";
            if (!isAllowedLinkHref(href)) return false;
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

/** The extensions that define a Polaris document, configured as the editor uses them. */
export function documentExtensions(options: DocumentExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        // Only http, https and mailto, wherever a link comes from: typed, pasted, parsed.
        isAllowedUri: (url) => isAllowedLinkUri(url),
        HTMLAttributes: LINK_ATTRIBUTES,
      },
    }),
    Footnote.configure({ onEdit: options.onEditFootnote ?? null }),
    LinkBehaviour.configure({ onShortcut: options.onLinkShortcut ?? null }),
  ];
}
