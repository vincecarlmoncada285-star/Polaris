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

  it("refuses to set a disallowed link", () => {
    const editor = make("<p>text</p>");
    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
    expect(editor.commands.setLink({ href: "https://example.com" })).toBe(true);
    expect(editor.getHTML()).toContain('href="https://example.com"');
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
