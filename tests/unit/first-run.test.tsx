// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_RUN_DISMISSED_KEY, FirstRunHelp } from "@/components/FirstRunHelp";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = () => screen.queryByRole("region", { name: "How Polaris works" });
const AI_OFF = { enabled: false, configured: true };
const AI_ON = { enabled: true, configured: true };

describe("the first-run help", () => {
  it("shows on an empty document and says how Polaris works", () => {
    render(<FirstRunHelp emptyDocument ai={AI_OFF} />);
    const text = card()!.textContent!;
    expect(text).toContain("Underlines appear as you type");
    expect(text).toContain("off until you turn them on in Settings");
    expect(text).toContain("Overview");
    expect(text).toContain("Review");
    expect(text).toContain("Import");
    expect(text).toContain("Export");
  });

  it("says AI is on when the writer has turned it on", () => {
    render(<FirstRunHelp emptyDocument ai={AI_ON} />);
    expect(card()!.textContent).toContain("are on for your account");
    expect(card()!.textContent).not.toContain("off until");
  });

  it("on a server without AI, says so and does not send the writer to Settings for it", () => {
    for (const enabled of [false, true]) {
      const { unmount } = render(
        <FirstRunHelp emptyDocument ai={{ enabled, configured: false }} />,
      );
      expect(card()!.textContent).toContain(
        "AI suggestions and reviews by Claude aren’t set up on this server.",
      );
      expect(card()!.textContent).not.toContain("off until");
      expect(card()!.textContent).not.toContain("on for your account");
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
      unmount();
    }
  });

  it("moves the keyboard on when dismissed with focus on it, not when focus is elsewhere", () => {
    const onDismissFocus = vi.fn();
    const { unmount } = render(
      <FirstRunHelp emptyDocument ai={AI_OFF} onDismissFocus={onDismissFocus} />,
    );
    const button = screen.getByRole("button", { name: "Got it" });
    button.focus();
    fireEvent.click(button);
    expect(card()).toBeNull();
    expect(onDismissFocus).toHaveBeenCalledTimes(1);
    unmount();

    localStorage.clear();
    render(<FirstRunHelp emptyDocument ai={AI_OFF} onDismissFocus={onDismissFocus} />);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismissFocus).toHaveBeenCalledTimes(1);
  });

  it("does not show on a document that already has text", () => {
    render(<FirstRunHelp emptyDocument={false} ai={AI_OFF} />);
    expect(card()).toBeNull();
  });

  it("stays dismissed in this browser", () => {
    const { unmount } = render(<FirstRunHelp emptyDocument ai={AI_OFF} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(FIRST_RUN_DISMISSED_KEY)).toBe("1");
    unmount();
    render(<FirstRunHelp emptyDocument ai={AI_OFF} />);
    expect(card()).toBeNull();
  });

  it("is not in the server's render, which cannot know whether it was dismissed", () => {
    expect(renderToString(<FirstRunHelp emptyDocument ai={AI_OFF} />)).toBe("");
  });

  it("shows, and can be closed, when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<FirstRunHelp emptyDocument ai={null} />);
    expect(card()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
  });
});
