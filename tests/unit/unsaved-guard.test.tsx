// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SaveStatus } from "@/lib/autosave";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/components/useUnsavedChangesGuard";

afterEach(cleanup);

function Guarded({ status }: { status: SaveStatus }) {
  useUnsavedChangesGuard(status);
  return null;
}

/** Whether leaving the page now would ask first. */
function asks(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("the unsaved-changes guard", () => {
  it("is on while an edit is waiting, being saved, or failed to save", () => {
    expect(hasUnsavedChanges("pending")).toBe(true);
    expect(hasUnsavedChanges("saving")).toBe(true);
    expect(hasUnsavedChanges("error")).toBe(true);
    expect(hasUnsavedChanges("saved")).toBe(false);
    expect(hasUnsavedChanges("idle")).toBe(false);
  });

  it("asks before leaving only in those states, and stops when saved or unmounted", () => {
    const { rerender, unmount } = render(<Guarded status="idle" />);
    expect(asks()).toBe(false);
    rerender(<Guarded status="pending" />);
    expect(asks()).toBe(true);
    rerender(<Guarded status="saving" />);
    expect(asks()).toBe(true);
    rerender(<Guarded status="saved" />);
    expect(asks()).toBe(false);
    rerender(<Guarded status="error" />);
    expect(asks()).toBe(true);
    unmount();
    expect(asks()).toBe(false);
  });
});
