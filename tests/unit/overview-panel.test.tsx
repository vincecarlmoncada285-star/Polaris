// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METRICS_IDLE_MS, OverviewPanel, targetProgressText } from "@/components/OverviewPanel";
import type { Suggestion } from "@/lib/editor/suggestions";
import type { Category } from "@/lib/rules/types";
import { textToBlocks, type SentenceLocation } from "@/lib/text/metrics";

const suggestion = (category: Category, key: string): Suggestion => ({
  ruleId: "test",
  category,
  start: 0,
  end: 1,
  message: "m",
  explanation: "e",
  replacements: [],
  key,
  source: "rules",
  from: 1,
  to: 2,
  blockText: "x",
  blockFrom: 1,
});

function panel(props: Partial<Parameters<typeof OverviewPanel>[0]> & { text: string }) {
  const getBlocks = vi.fn(() => textToBlocks(props.text));
  const onSelectSentence = vi.fn<(s: SentenceLocation) => boolean>(() => true);
  const onEditGoals = vi.fn();
  const element = (
    <OverviewPanel
      active
      layout=""
      words={props.text.split(/\s+/).filter(Boolean).length}
      getBlocks={getBlocks}
      suggestions={[]}
      onSelectSentence={onSelectSentence}
      onEditGoals={onEditGoals}
      {...props}
    />
  );
  return { element, getBlocks, onSelectSentence, onEditGoals };
}

const metric = (testId: string) => screen.getByTestId(testId).querySelector("dd")!.textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Overview metrics", () => {
  it("computes as soon as it is shown, then again only once typing pauses", () => {
    const first = panel({ text: "One sentence here." });
    const { rerender } = render(first.element);
    expect(metric("metric-words")).toBe("3");
    expect(metric("metric-sentences")).toBe("1");

    // Two keystrokes in quick succession: nothing is recomputed until 300 ms after the last.
    rerender(panel({ text: "One sentence here. Two", getBlocks: first.getBlocks }).element);
    act(() => void vi.advanceTimersByTime(METRICS_IDLE_MS - 50));
    rerender(panel({ text: "One sentence here. Two more.", getBlocks: first.getBlocks }).element);
    act(() => void vi.advanceTimersByTime(METRICS_IDLE_MS - 50));
    expect(first.getBlocks).toHaveBeenCalledTimes(1);
    expect(metric("metric-sentences")).toBe("1");
    act(() => void vi.advanceTimersByTime(60));
    expect(first.getBlocks).toHaveBeenCalledTimes(2);
  });

  it("recomputes when a paragraph becomes a heading, though the text is the same", () => {
    const text = "Intro\n\nOne sentence here.";
    const first = panel({ text, layout: "0,0" });
    const { rerender } = render(first.element);
    expect(metric("metric-sentences")).toBe("2");
    const asHeading = vi.fn(() => [
      { text: "Intro", heading: true },
      { text: "One sentence here." },
    ]);
    rerender(panel({ text, layout: "2,0", getBlocks: asHeading }).element);
    act(() => void vi.advanceTimersByTime(METRICS_IDLE_MS));
    expect(asHeading).toHaveBeenCalledTimes(1);
    expect(metric("metric-sentences")).toBe("1");
    // Back again, after the tab was hidden: shown again, it catches up straight away.
    rerender(panel({ text, layout: "2,0", active: false, getBlocks: asHeading }).element);
    rerender(panel({ text, layout: "0,0", getBlocks: first.getBlocks }).element);
    expect(metric("metric-sentences")).toBe("2");
  });

  it("computes nothing while hidden, and catches up straight away when shown", () => {
    const hidden = panel({ text: "Some text.", active: false });
    const { rerender } = render(hidden.element);
    act(() => void vi.advanceTimersByTime(1000));
    expect(hidden.getBlocks).not.toHaveBeenCalled();
    rerender(panel({ text: "Some text.", active: true, getBlocks: hidden.getBlocks }).element);
    expect(hidden.getBlocks).toHaveBeenCalledTimes(1);
  });

  it("says to start writing for an empty document", () => {
    render(panel({ text: "" }).element);
    expect(screen.getByText("Start writing to see an overview of your document.")).toBeTruthy();
  });

  it("holds back readability scores under 100 words, with the reason", () => {
    render(panel({ text: "A short draft. It has few words." }).element);
    expect(metric("metric-reading-ease")).toContain("—");
    expect(screen.getByTestId("metric-reading-ease").textContent).toContain(
      "need at least 100 words",
    );
  });

  it("shows readability with the plain-language caveat once there is enough text", () => {
    const text = "The cat sat on the mat. ".repeat(20);
    render(panel({ text }).element);
    expect(metric("metric-reading-ease")).toMatch(/^\d+ · /);
    expect(screen.getByTestId("metric-reading-ease").textContent).toContain(
      "Readability scores are rough estimates made for general prose. Academic writing usually scores as difficult, and that is normal.",
    );
    // No single overall score anywhere.
    expect(screen.queryByText(/overall score/i)).toBeNull();
  });

  it("selects the longest sentence, and announces it if it has gone", () => {
    const text = "Short. This one is clearly the longest sentence here. Tiny.";
    const p = panel({ text });
    render(p.element);
    // Named for what it is (the visible "8 words" included), described by its hint.
    const button = screen.getByRole("button", { name: "Longest sentence, 8 words" });
    expect(button.textContent).toBe("8 words");
    expect(screen.getByRole("button", { description: "Select it to find it in your text." })).toBe(
      button,
    );
    fireEvent.click(button);
    expect(p.onSelectSentence).toHaveBeenCalledWith(
      expect.objectContaining({ text: "This one is clearly the longest sentence here.", words: 8 }),
    );
    p.onSelectSentence.mockReturnValue(false);
    const live = screen.getByTestId("metric-longest").querySelector("[aria-live=polite]")!;
    expect(live.textContent).toBe("");
    fireEvent.click(button);
    // Focus stays on the button: the message appears in a live region that was already there.
    expect(screen.getByTestId("metric-longest").querySelector("[aria-live=polite]")).toBe(live);
    expect(live.textContent).toBe("That sentence has changed since this was measured.");
    expect(
      screen.getByRole("button", {
        description: "That sentence has changed since this was measured.",
      }),
    ).toBe(button);
  });

  it("lays each metric out as a term and its values, directly inside the list's groups", () => {
    render(panel({ text: "One sentence here. And another one." }).element);
    const list = screen.getByTestId("metric-words").closest("dl")!;
    for (const group of Array.from(list.children)) {
      expect(group.tagName).toBe("DIV");
      const kids = Array.from(group.children).map((c) => c.tagName);
      expect(kids[0]).toBe("DT");
      expect(kids.slice(1).every((t) => t === "DD")).toBe(true);
    }
  });

  it("lists repeated openers with counts", () => {
    render(panel({ text: "The a. The b. The c. However d. However e." }).element);
    expect(metric("metric-openers")).toBe("“The” (3)");
  });
});

describe("Overview suggestion counts", () => {
  it("shows a count and a rate per 1,000 words for every category, with decorative bars", () => {
    const text = Array.from({ length: 500 }, () => "word").join(" ");
    render(
      panel({
        text,
        words: 500,
        suggestions: [
          suggestion("clarity", "a"),
          suggestion("clarity", "b"),
          suggestion("formality", "c"),
        ],
      }).element,
    );
    const list = screen.getByTestId("suggestion-counts");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Correctness0 · 0.0 per 1,000 words",
      "Clarity2 · 4.0 per 1,000 words",
      "Concision0 · 0.0 per 1,000 words",
      "Formality1 · 2.0 per 1,000 words",
      "Citations0 · 0.0 per 1,000 words",
    ]);
    const bars = list.querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(5);
  });
});

describe("Overview target length", () => {
  it("shows progress as text and as a progressbar", () => {
    render(panel({ text: "x", words: 1240, targetWords: 2000 }).element);
    const bar = screen.getByRole("progressbar", { name: "Target length" });
    expect(bar.getAttribute("aria-valuenow")).toBe("1240");
    expect(bar.getAttribute("aria-valuemax")).toBe("2000");
    expect(bar.getAttribute("aria-valuetext")).toBe("1,240 of 2,000 words (62%)");
    expect(screen.getByTestId("target-progress-text").textContent).toBe(
      "1,240 of 2,000 words (62%)",
    );
  });

  it("shows going over the target neutrally, keeping aria-valuenow within range", () => {
    render(panel({ text: "x", words: 2300, targetWords: 2000 }).element);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2000");
    expect(bar.getAttribute("aria-valuetext")).toBe("2,300 of 2,000 words (115%)");
    expect(screen.getByText("300 words over the target.").className).toContain("text-muted");
  });

  it("offers to set a target when there is none", () => {
    const p = panel({ text: "x" });
    render(p.element);
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set one in Goals" }));
    expect(p.onEditGoals).toHaveBeenCalled();
  });

  it("formats progress text", () => {
    expect(targetProgressText(0, 50)).toBe("0 of 50 words (0%)");
    expect(targetProgressText(1999, 2000)).toBe("1,999 of 2,000 words (100%)");
  });
});
