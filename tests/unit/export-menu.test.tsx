// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportMenu } from "@/components/ExportMenu";

afterEach(cleanup);

const exportButton = () => screen.getByRole("button", { name: /^Export/ });

async function choose(name: string) {
  fireEvent.click(exportButton());
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name }));
  });
}

describe("Export menu", () => {
  it("shows a failed export on a surface of its own, until dismissed or the menu opens", async () => {
    const onExport = vi.fn(() => Promise.reject(new Error("chunk failed to load")));
    render(<ExportMenu onExport={onExport} />);
    await choose("Word (.docx)");
    expect(onExport).toHaveBeenCalledWith("docx");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Couldn’t export this document/);
    // Drawn on the page's surface (with a border), not straight over the document text.
    expect(alert.parentElement!.className).toMatch(/\bbg-surface\b/);
    expect(alert.parentElement!.className).toMatch(/\bborder\b/);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss the export error" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(exportButton());

    // Failing again, then opening the menu for another try: the old error goes.
    await choose("Markdown (.md)");
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(exportButton());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("gives its items a visible focus outline, not only a tint", () => {
    render(<ExportMenu onExport={async () => {}} />);
    fireEvent.keyDown(exportButton(), { key: "ArrowDown" });
    const item = screen.getByRole("menuitem", { name: "Word (.docx)" });
    expect(document.activeElement).toBe(item);
    expect(item.className).toMatch(/focus-visible:outline-2\b/);
    expect(item.className).not.toMatch(/outline-none/);
  });
});
