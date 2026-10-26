// The editor's schema in one place: the document editor, the importer (which parses HTML with
// exactly this schema, so whatever the editor cannot show is dropped) and the tests use this
// list. The editor adds its UI-only extensions (placeholder, suggestions) on top.
import { Extension, mergeAttributes, type AnyExtension } from "@tiptap/core";
import { Link } from "@tiptap/extension-link";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Footnote, type FootnoteTarget } from "./footnote";
import { exportableHref, isAllowedLinkHref, isAllowedLinkUri } from "./links";

/** Every link opens in a new tab, and passes on nothing about Polaris or the writer. */
export const LINK_ATTRIBUTES = { rel: "noopener noreferrer nofollow", target: "_blank" } as const;

/** TipTap's own test for found text: no bare IP addresses or one-word hosts ("localhost"). */
const tiptapShouldAutoLink = Link.options.shouldAutoLink;

/**
 * The Link mark StarterKit bundles, with one attribute: its href. TipTap's mark also keeps the
 * rel, target, class and title of the HTML it was pasted from (or of stored JSON), and those win
 * over LINK_ATTRIBUTES; here they are not attributes at all, so every link renders with exactly
 * LINK_ATTRIBUTES (the options) and nothing a copied page set.
 */
const PolarisLink = Link.extend({
  addAttributes() {
    // As TipTap's own: read from the element (parseHTML below decides whether the link stays).
    return { href: { default: null, parseHTML: (element) => element.getAttribute("href") } };
  },

  // A link read from HTML (pasted or imported) must be an absolute http, https or mailto URL.
  // TipTap checks it with isAllowedUri, which has to let a bare "www.example.com" through for
  // autolinking (the link it then makes has the scheme), so it would keep a relative href such
  // as "page.html" as it is. Here the strict check decides; the text stays either way.
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (dom) =>
          isAllowedLinkHref((dom as HTMLElement).getAttribute("href")) ? null : false,
      },
    ];
  },

  // Stored JSON is whatever PATCH /api/documents was sent, so a mark's href can be anything.
  // TipTap renders it if isAllowedUri passes, which lets a bare "www.example.com" through as a
  // relative href. Here a link is shown with exactly the href an export writes (a bare address
  // gets https:// or mailto:), and with no href at all when it has none Polaris allows.
  renderHTML({ HTMLAttributes }) {
    const href = exportableHref(HTMLAttributes.href);
    return ["a", mergeAttributes(this.options.HTMLAttributes, { ...HTMLAttributes, href }), 0];
  },

  // setLink and toggleLink check isAllowedUri too: a link set by command must already be an
  // absolute http, https or mailto URL (the link dialog adds the scheme itself).
  addCommands() {
    const commands = this.parent?.() ?? {};
    const { setLink, toggleLink } = commands;
    return {
      ...commands,
      setLink: (attributes) => (props) =>
        isAllowedLinkHref(attributes.href) && !!setLink?.(attributes)(props),
      toggleLink: (attributes) => (props) =>
        (!attributes?.href || isAllowedLinkHref(attributes.href)) &&
        !!toggleLink?.(attributes)(props),
    };
  },
});

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

/**
 * Superscript and subscript (10⁻³, CO₂, the 2nd), which cannot both apply to the same text. A
 * footnote marker is a <sup data-footnote> too, and that is the footnote node, never this mark:
 * marks' parse rules are tried before nodes', so the mark has to let it pass.
 */
const PolarisSuperscript = Superscript.extend({
  excludes: "subscript",
  parseHTML() {
    return [
      { tag: "sup", getAttrs: (el) => (el.hasAttribute("data-footnote") ? false : null) },
      { style: "vertical-align", getAttrs: (value) => (value === "super" ? null : false) },
    ];
  },
});
const PolarisSubscript = Subscript.extend({ excludes: "superscript" });

/** The extensions that define a Polaris document, configured as the editor uses them. */
export function documentExtensions(options: DocumentExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
    PolarisLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      // Only http, https and mailto, wherever a link comes from: typed, pasted, parsed.
      isAllowedUri: (url) => isAllowedLinkUri(url),
      // Pasting an address over selected text checks only this, not isAllowedUri.
      shouldAutoLink: (url) => isAllowedLinkUri(url) && tiptapShouldAutoLink(url),
      HTMLAttributes: LINK_ATTRIBUTES,
    }),
    PolarisSuperscript,
    PolarisSubscript,
    Footnote.configure({ onEdit: options.onEditFootnote ?? null }),
    LinkBehaviour.configure({ onShortcut: options.onLinkShortcut ?? null }),
  ];
}
