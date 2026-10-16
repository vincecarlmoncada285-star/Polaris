// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SuggestionPanel, aiStatusLine, type AiPanelState } from "@/components/SuggestionPanel";

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
