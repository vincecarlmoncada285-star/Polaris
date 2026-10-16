// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelTabs, useRememberedTab } from "@/components/PanelTabs";

const IDS = ["suggestions", "overview", "review"] as const;
type Id = (typeof IDS)[number];
const KEY = "test:panel-tab";

/** A panel with its own state, to check that switching tabs keeps it. */
function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      Clicked {n}
    </button>
  );
}

function Harness() {
  const [selected, setSelected, show] = useRememberedTab<Id>(KEY, IDS, "suggestions");
  return (
    <>
      <button type="button" onClick={() => show("suggestions")}>
        Show suggestions
      </button>
      <PanelTabs
        label="Writing tools"
        idPrefix="panel"
        selected={selected}
        onSelect={setSelected}
        tabs={[
          { id: "suggestions", label: "Suggestions", panel: <Counter /> },
          { id: "overview", label: "Overview", panel: <p>Overview body</p> },
          { id: "review", label: "Review", panel: <p>Review body</p> },
        ]}
      />
    </>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
const selectedTab = () => screen.getByRole("tab", { selected: true });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("panel tabs: structure", () => {
  it("is a labelled tablist whose tabs control labelled tabpanels", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Writing tools" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Suggestions", "Overview", "Review"]);
    for (const t of tabs) {
      const panel = document.getElementById(t.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(t.id);
    }
  });

  it("selects the first tab by default and shows only its panel", () => {
    render(<Harness />);
    expect(selectedTab()).toBe(tab("Suggestions"));
    expect(tab("Overview").getAttribute("aria-selected")).toBe("false");
    // Hidden panels are out of the accessibility tree; the visible one is named by its tab.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel", { name: "Suggestions" })).toBeTruthy();
  });

  it("keeps only the selected tab in the Tab order (roving tabindex)", () => {
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(tab("Review"));
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });
});

describe("panel tabs: keyboard", () => {
  it("moves focus and selection with Right and Left, wrapping at the ends", () => {
    render(<Harness />);
    tab("Suggestions").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Overview"));
    expect(selectedTab()).toBe(tab("Overview"));
    expect(screen.getByRole("tabpanel", { name: "Overview" }).textContent).toBe("Overview body");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("Suggestions"));
    expect(selectedTab()).toBe(tab("Suggestions"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("Review"));
    expect(selectedTab()).toBe(tab("Review"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(selectedTab()).toBe(tab("Overview"));
  });

  it("goes to the first tab with Home and the last with End", () => {
    render(<Harness />);
    tab("Suggestions").focus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(tab("Review"));
    expect(selectedTab()).toBe(tab("Review"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(tab("Suggestions"));
    expect(selectedTab()).toBe(tab("Suggestions"));
  });

  it("ignores other keys and lets them through", () => {
    render(<Harness />);
    tab("Overview").focus();
    for (const key of ["ArrowDown", "ArrowUp", "a", "Enter", "Tab"]) {
      const event = fireEvent.keyDown(document.activeElement!, { key });
      // fireEvent returns false only when a handler called preventDefault().
      expect(event).toBe(true);
    }
    expect(selectedTab()).toBe(tab("Suggestions"));
  });
});

describe("panel tabs: state", () => {
  it("keeps a hidden panel mounted, so it keeps its state", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Clicked 0" }));
    fireEvent.click(tab("Review"));
    fireEvent.click(tab("Suggestions"));
    expect(screen.getByRole("button", { name: "Clicked 1" })).toBeTruthy();
  });

  it("remembers the chosen tab in this browser", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(tab("Review"));
    expect(window.localStorage.getItem(KEY)).toBe("review");
    unmount();
    render(<Harness />);
    expect(selectedTab()).toBe(tab("Review"));
  });

  it("can show a tab without remembering it as the writer's choice", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "Show suggestions" }));
    expect(selectedTab()).toBe(tab("Suggestions"));
    expect(window.localStorage.getItem(KEY)).toBe("review");
    unmount();
    render(<Harness />);
    expect(selectedTab()).toBe(tab("Review"));
  });

  it("ignores a stored value that is not a tab", () => {
    window.localStorage.setItem(KEY, "settings");
    render(<Harness />);
    expect(selectedTab()).toBe(tab("Suggestions"));
  });

  it("works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<Harness />);
    expect(selectedTab()).toBe(tab("Suggestions"));
    fireEvent.click(tab("Overview"));
    expect(selectedTab()).toBe(tab("Overview"));
  });
});
