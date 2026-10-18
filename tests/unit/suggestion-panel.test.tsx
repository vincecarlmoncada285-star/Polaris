// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SuggestionPanel,
  aiStatusLine,
  scrollToShow,
  type AiPanelState,
} from "@/components/SuggestionPanel";
import type { Suggestion } from "@/lib/editor/suggestions";

afterEach(cleanup);

function panel(ai: AiPanelState) {
  return (
    <SuggestionPanel
      suggestions={[]}
      activeKey={null}
      ai={ai}
      onActivate={() => {}}
      onApply={() => {}}
      onDismiss={() => {}}
    />
  );
}

describe("the AI line in the suggestions panel", () => {
  it.each<[AiPanelState, string]>([
    [{ kind: "off" }, "AI suggestions are off. Turn them on in Settings."],
    [{ kind: "not_configured" }, "AI suggestions aren’t set up on this server."],
    [{ kind: "unknown" }, "AI suggestions unavailable"],
  ])("shows %o as plain text, outside the live region, so it is not announced", (ai, text) => {
    render(panel(ai));
    expect(screen.getByTestId("ai-status").textContent).toBe(text);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows nothing while loading, with the live region already in place", () => {
    render(panel({ kind: "loading" }));
    expect(screen.getByTestId("ai-status").textContent).toBe("");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("announces what the AI checks are doing", () => {
    const { rerender } = render(panel({ kind: "on", status: { kind: "idle" } }));
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    rerender(panel({ kind: "on", status: { kind: "checking", count: 2 } }));
    expect(screen.getByRole("status")).toBe(live);
    expect(live.textContent).toBe("Checking 2 paragraphs…");
    rerender(panel({ kind: "on", status: { kind: "error", reason: "failed" } }));
    expect(live.textContent).toBe("AI suggestions unavailable");
  });
});

describe("aiStatusLine", () => {
  const morning = new Date(2026, 9, 16, 10, 0).getTime();
  const timeOf = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  it("calls a short rate-limit pause a moment", () => {
    expect(
      aiStatusLine({ kind: "error", reason: "rate_limited", until: morning + 60_000 }, morning),
    ).toBe("AI suggestions paused for a moment (too many requests).");
  });

  it("says until when for a long pause, such as the daily limit", () => {
    const until = morning + 3 * 3_600_000;
    expect(aiStatusLine({ kind: "error", reason: "rate_limited", until }, morning)).toBe(
      `AI suggestions paused until ${timeOf(until)} (usage limit reached).`,
    );
  });

  it("says tomorrow when the pause runs past midnight", () => {
    const evening = new Date(2026, 9, 16, 22, 0).getTime();
    const until = evening + 20 * 3_600_000;
    expect(aiStatusLine({ kind: "error", reason: "rate_limited", until }, evening)).toBe(
      `AI suggestions paused until tomorrow at ${timeOf(until)} (usage limit reached).`,
    );
  });
});

describe("the open suggestion's card", () => {
  const suggestion = (key: string, category: Suggestion["category"], text: string): Suggestion => ({
    key,
    ruleId: "test",
    category,
    message: `${category} message`,
    explanation: "Why it matters.",
    replacements: [],
    start: 0,
    end: text.length,
    source: "rules",
    from: 1,
    to: 1 + text.length,
    blockText: text,
    blockFrom: 1,
  });
  const list = [suggestion("f", "formality", "don't"), suggestion("c", "clarity", "this")];
  const panelWith = (activeKey: string | null) => (
    <SuggestionPanel
      suggestions={list}
      activeKey={activeKey}
      ai={{ kind: "off" }}
      onActivate={() => {}}
      onApply={() => {}}
      onDismiss={() => {}}
    />
  );
  const cards = () => screen.queryAllByTestId("suggestion-card");
  const filter = (name: RegExp) =>
    within(screen.getByRole("group", { name: "Filter by category" })).getByRole("button", {
      name,
    });

  it("shows when it is opened from the text (Alt+], a click), even if the filter hid it", () => {
    const { rerender } = render(panelWith(null));
    fireEvent.click(filter(/^Clarity/));
    expect(cards().map((c) => c.getAttribute("data-suggestion-key"))).toEqual(["c"]);
    rerender(panelWith("f"));
    expect(filter(/^All/).getAttribute("aria-pressed")).toBe("true");
    const open = cards().find((c) => c.getAttribute("data-suggestion-key") === "f")!;
    expect(open.querySelector("[aria-expanded=true]")).not.toBeNull();
  });

  it("keeps the writer's filter when the open card is in it, or when they pick one", () => {
    const { rerender } = render(panelWith(null));
    fireEvent.click(filter(/^Clarity/));
    rerender(panelWith("c"));
    expect(filter(/^Clarity/).getAttribute("aria-pressed")).toBe("true");
    // With a card open, choosing another filter is still the writer's choice.
    fireEvent.click(filter(/^Formality/));
    expect(filter(/^Formality/).getAttribute("aria-pressed")).toBe("true");
    expect(cards().map((c) => c.getAttribute("data-suggestion-key"))).toEqual(["f"]);
  });

  it("is brought into view inside the list only, never by scrolling the page", () => {
    // jsdom has no scrollIntoView; a browser's would scroll the window too.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender, container } = render(panelWith(null));
      const ul = container.querySelector("ul")!;
      // The panel under the article on a narrow screen: the list does not scroll by itself, so
      // nothing moves (the writer stays at the text they clicked, or that Alt+] showed).
      rerender(panelWith("c"));
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(ul.scrollTop).toBe(0);

      // The side panel on a wide screen, whose list scrolls: just enough to show the card.
      Object.defineProperty(ul, "scrollHeight", { configurable: true, value: 500 });
      Object.defineProperty(ul, "clientHeight", { configurable: true, value: 100 });
      ul.getBoundingClientRect = () => ({ top: 100, bottom: 200 }) as DOMRect;
      const card = cards().find((c) => c.getAttribute("data-suggestion-key") === "f")!;
      card.getBoundingClientRect = () => ({ top: 250, bottom: 300 }) as DOMRect;
      rerender(panelWith("f"));
      expect(ul.scrollTop).toBe(100);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe("scrollToShow", () => {
  const box = { top: 100, bottom: 300 };
  it("is nothing for an item already in the box", () => {
    expect(scrollToShow(box, { top: 120, bottom: 200 })).toBe(0);
    expect(scrollToShow(box, { top: 100, bottom: 300 })).toBe(0);
  });
  it("is just enough to show an item above or below the box", () => {
    expect(scrollToShow(box, { top: 40, bottom: 90 })).toBe(-60);
    expect(scrollToShow(box, { top: 280, bottom: 350 })).toBe(50);
  });
  it("shows the top of an item taller than the box", () => {
    expect(scrollToShow(box, { top: 150, bottom: 600 })).toBe(50);
  });
});
