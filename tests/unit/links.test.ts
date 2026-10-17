// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "@/lib/editor/extensions";
import {
  exportableHref,
  isAllowedLinkHref,
  isAllowedLinkUri,
  normalizeLinkInput,
} from "@/lib/editor/links";

const ALLOWED = [
  "http://example.com",
  "https://example.com/path?q=1#frag",
  "HTTPS://EXAMPLE.COM",
  "mailto:ana@example.com",
  "https://user@example.com:8443/x",
  // Read as a browser reads it: surrounding spaces and controls do not hide the scheme.
  "  https://example.com  ",
  "\nhttps://example.com",
];

const REFUSED = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "\tjavascript:alert(1)",
  "\u0000javascript:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "javascript://example.com/%0Aalert(1)",
  "data:text/html,<script>alert(1)</script>",
  "DATA:text/html;base64,PHNjcmlwdD4=",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "ftp://example.com",
  "tel:+441234567890",
  "//evil.com",
  "///evil.com",
  "\\\\evil.com",
  "/relative/path",
  "#anchor",
  "relative.html",
  "",
  "   ",
  "https:",
  "http://",
];

describe("isAllowedLinkHref (strict: what may be stored and exported)", () => {
  it.each(ALLOWED)("accepts %j", (href) => {
    expect(isAllowedLinkHref(href)).toBe(true);
  });

  it.each(REFUSED)("refuses %j", (href) => {
    expect(isAllowedLinkHref(href)).toBe(false);
  });

  it("refuses non-strings", () => {
    expect(isAllowedLinkHref(null)).toBe(false);
    expect(isAllowedLinkHref(undefined)).toBe(false);
    expect(isAllowedLinkHref({ href: "https://example.com" })).toBe(false);
  });
});

describe("isAllowedLinkUri (the Link extension's check, which autolinking also uses)", () => {
  it.each([...ALLOWED, "www.example.com", "example.org/page", "ana@example.com"])(
    "accepts %j",
    (href) => {
      expect(isAllowedLinkUri(href)).toBe(true);
    },
  );

  it.each(REFUSED.filter((r) => r !== "relative.html"))("refuses %j", (href) => {
    expect(isAllowedLinkUri(href)).toBe(false);
  });
});

describe("normalizeLinkInput (the link dialog)", () => {
  it("adds https:// to a bare web address and mailto: to an email address", () => {
    expect(normalizeLinkInput(" www.example.com/a ")).toBe("https://www.example.com/a");
    expect(normalizeLinkInput("example.org:8080/x")).toBe("https://example.org:8080/x");
    expect(normalizeLinkInput("ana@example.com")).toBe("mailto:ana@example.com");
    expect(normalizeLinkInput("https://example.com")).toBe("https://example.com");
  });

  it("returns an empty string for an empty field (remove the link)", () => {
    expect(normalizeLinkInput("   ")).toBe("");
  });

  it.each([
    "javascript:alert(1)",
    " JaVaScRiPt:x",
    "data:x",
    "//evil.com",
    "not a url",
    "localhost:3000",
  ])("refuses %j", (input) => {
    expect(normalizeLinkInput(input)).toBeNull();
  });

  it("exports only allowed hrefs", () => {
    expect(exportableHref("https://example.com")).toBe("https://example.com");
    expect(exportableHref("javascript:alert(1)")).toBeNull();
    expect(exportableHref(42)).toBeNull();
  });
});

describe("links in the editor", () => {
  const make = (html: string) =>
    new Editor({
      element: document.createElement("div"),
      extensions: documentExtensions(),
      content: html,
    });

  it("keeps an allowed link, with rel and target, and drops a javascript: one", () => {
    const editor = make(
      '<p><a href="https://example.com">good</a> and <a href="javascript:alert(1)">bad</a> and <a href="//evil.com">sly</a></p>',
    );
    const links = editor.view.dom.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("https://example.com");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(editor.getText()).toBe("good and bad and sly");
    editor.destroy();
  });

  // jsdom has no ClipboardEvent; ProseMirror only needs an event to hand to the paste handlers.
  const pasteEvent = () => new Event("paste") as ClipboardEvent;
  const linkMarks = (editor: Editor) =>
    JSON.stringify(editor.getJSON()).match(/\{"type":"link"[^}]*\}\}/g) ?? [];

  it.each(["ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)"])(
    "does not link selected text to a pasted %s address",
    (url) => {
      const editor = make("<p>see the report now</p>");
      editor.commands.setTextSelection({ from: 5, to: 15 });
      editor.view.pasteText(url, pasteEvent());
      expect(linkMarks(editor)).toEqual([]);
      expect(editor.view.dom.querySelector("a")).toBeNull();
      editor.destroy();
    },
  );

  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["www.example.com", "https://www.example.com"],
  ])("links selected text to a pasted %s address", (url, href) => {
    const editor = make("<p>see the report now</p>");
    editor.commands.setTextSelection({ from: 5, to: 15 });
    editor.view.pasteText(url, pasteEvent());
    expect(linkMarks(editor)).toEqual([`{"type":"link","attrs":{"href":"${href}"}}`]);
    expect(editor.view.dom.querySelector("a")!.textContent).toBe("the report");
    editor.destroy();
  });

  it("keeps a pasted link only when its href is an absolute http, https or mailto URL", () => {
    const editor = make("<p></p>");
    editor.view.pasteHTML(
      '<p><a href="https://example.com/a">abs</a> <a href="www.example.com">bare</a> <a href="page.html">rel</a> <a href="mailto:ana@example.com">mail</a></p>',
      pasteEvent(),
    );
    expect(linkMarks(editor)).toEqual([
      '{"type":"link","attrs":{"href":"https://example.com/a"}}',
      '{"type":"link","attrs":{"href":"mailto:ana@example.com"}}',
    ]);
    expect(editor.getText()).toBe("abs bare rel mail");
    editor.destroy();
  });

  it("keeps only the href of a pasted or stored link: rel and target are always Polaris's", () => {
    const fixed = (editor: Editor) => {
      const a = editor.view.dom.querySelector("a")!;
      expect([...a.attributes].map((x) => [x.name, x.value]).sort()).toEqual([
        ["href", "https://example.com/login"],
        ["rel", "noopener noreferrer nofollow"],
        ["target", "_blank"],
      ]);
      expect(linkMarks(editor)).toEqual([
        '{"type":"link","attrs":{"href":"https://example.com/login"}}',
      ]);
      expect(editor.getHTML()).not.toMatch(/opener"|_self|_top|class=|title=/);
    };
    const pasted = make("<p>x</p>");
    pasted.view.pasteHTML(
      '<p><a href="https://example.com/login" rel="opener" target="_self" class="absolute h-screen" title="Sign in">source</a></p>',
      pasteEvent(),
    );
    fixed(pasted);
    pasted.destroy();

    const stored = new Editor({
      element: document.createElement("div"),
      extensions: documentExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "source",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.com/login",
                      rel: "opener",
                      target: "_top",
                      class: "absolute h-screen",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    fixed(stored);
    stored.destroy();
  });

  it("refuses to set a disallowed link", () => {
    const editor = make("<p>text</p>");
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
    expect(editor.commands.toggleLink({ href: "javascript:alert(1)" })).toBe(false);
    // A command takes only an absolute URL (the link dialog adds https:// itself): a bare
    // address would be stored, and shown, as a relative link.
    expect(editor.commands.setLink({ href: "www.example.com" })).toBe(false);
    expect(editor.commands.toggleLink({ href: "page.html" })).toBe(false);
    expect(linkMarks(editor)).toEqual([]);
    expect(editor.commands.setLink({ href: "https://example.com" })).toBe(true);
    expect(editor.getHTML()).toContain('href="https://example.com"');
    expect(editor.commands.toggleLink()).toBe(true);
    expect(linkMarks(editor)).toEqual([]);
    expect(editor.commands.toggleLink({ href: "mailto:ana@example.com" })).toBe(true);
    expect(editor.getHTML()).toContain('href="mailto:ana@example.com"');
    editor.destroy();
  });

  // Stored JSON is whatever PATCH /api/documents was sent; a link in it is shown, and exported,
  // only with an absolute http, https or mailto href, never as a relative or javascript: one.
  it.each([
    ["www.example.com", "https://www.example.com"],
    ["ana@example.com", "mailto:ana@example.com"],
    [" https://example.com/a ", "https://example.com/a"],
    ["https://example.com/a", "https://example.com/a"],
    ["/documents/other", null],
    ["#top", null],
    ["//evil.com", null],
    ["javascript:alert(1)", null],
    ["JaVaScRiPt:alert(1)", null],
    ["data:text/html,<script>alert(1)</script>", null],
    ["", null],
  ])("renders a stored link to %j with the href %j", (href, shown) => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: documentExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "site", marks: [{ type: "link", attrs: { href } }] }],
          },
        ],
      },
    });
    const anchor = editor.view.dom.querySelector("a")!;
    expect(anchor.textContent).toBe("site");
    expect(anchor.getAttribute("href")).toBe(shown);
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    const html = new DOMParser().parseFromString(editor.getHTML(), "text/html");
    expect(html.querySelector("a")!.getAttribute("href")).toBe(shown);
    // What the editor shows is what an export writes.
    expect(exportableHref(href)).toBe(shown);
    editor.destroy();
  });

  it("opens a link on Ctrl-click only, in a new tab without an opener", () => {
    const editor = make('<p><a href="https://example.com">site</a></p>');
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    try {
      const anchor = editor.view.dom.querySelector("a")!;
      // ProseMirror's handleClick is what Polaris hooks: call it as a click on the link would.
      const handle = (init: MouseEventInit) => {
        const event = new MouseEvent("click", { ...init, bubbles: true });
        Object.defineProperty(event, "target", { value: anchor });
        return !!editor.view.someProp("handleClick", (f) => f(editor.view, 2, event));
      };
      expect(handle({})).toBe(false);
      expect(opened).toHaveLength(0);
      expect(handle({ ctrlKey: true })).toBe(true);
      expect(handle({ metaKey: true })).toBe(true);
      expect(opened).toEqual([
        ["https://example.com", "_blank", "noopener,noreferrer"],
        ["https://example.com", "_blank", "noopener,noreferrer"],
      ]);
    } finally {
      window.open = original;
      editor.destroy();
    }
  });
});
