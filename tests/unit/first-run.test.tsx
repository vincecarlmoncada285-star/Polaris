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

describe("the first-run help", () => {
  it("shows on an empty document and says how Polaris works", () => {
    render(<FirstRunHelp emptyDocument aiEnabled={false} />);
    const text = card()!.textContent!;
    expect(text).toContain("Underlines appear as you type");
    expect(text).toContain("off until you turn them on in Settings");
    expect(text).toContain("Overview");
    expect(text).toContain("Review");
    expect(text).toContain("Import");
    expect(text).toContain("Export");
  });

  it("says AI is on when the writer has turned it on", () => {
    render(<FirstRunHelp emptyDocument aiEnabled />);
    expect(card()!.textContent).toContain("are on for your account");
    expect(card()!.textContent).not.toContain("off until");
  });

  it("does not show on a document that already has text", () => {
    render(<FirstRunHelp emptyDocument={false} aiEnabled={false} />);
    expect(card()).toBeNull();
  });

  it("stays dismissed in this browser", () => {
    const { unmount } = render(<FirstRunHelp emptyDocument aiEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(FIRST_RUN_DISMISSED_KEY)).toBe("1");
    unmount();
    render(<FirstRunHelp emptyDocument aiEnabled={false} />);
    expect(card()).toBeNull();
  });

  it("is not in the server's render, which cannot know whether it was dismissed", () => {
    expect(renderToString(<FirstRunHelp emptyDocument aiEnabled={false} />)).toBe("");
  });

  it("shows, and can be closed, when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<FirstRunHelp emptyDocument aiEnabled={null} />);
    expect(card()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
  });
});
