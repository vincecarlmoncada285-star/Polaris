// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ImportNotice } from "@/components/ImportNotice";
import { saveImportNotice } from "@/lib/import/notice";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("the import notice", () => {
  it("shows under Strict Mode, which runs effects twice in development, and only once", () => {
    saveImportNotice("doc_1", "Imported from a.docx. 1 image was left out.");
    render(
      <StrictMode>
        <ImportNotice documentId="doc_1" />
      </StrictMode>,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Imported from a.docx. 1 image was left out.",
    );
    expect(screen.getByTestId("import-notice")).toBeTruthy();
    // Said once: opened again, the document has nothing to say.
    cleanup();
    render(<ImportNotice documentId="doc_1" />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByTestId("import-notice")).toBeNull();
  });

  it("keeps its live region in the page before the notice arrives and after it goes", () => {
    saveImportNotice("doc_2", "Imported from b.md.");
    // As the server renders it, and so as the page starts: an empty region, already there.
    const html = renderToString(<ImportNotice documentId="doc_2" />);
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    render(<ImportNotice documentId="doc_2" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("Imported from b.md.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("");
    expect(screen.queryByTestId("import-notice")).toBeNull();
  });
});
