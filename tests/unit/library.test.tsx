// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentLibrary, resultCountText } from "@/components/DocumentLibrary";
import {
  LIBRARY_SEARCH_KEY,
  LIBRARY_SORT_KEY,
  forgetSearch,
  foldForSearch,
  isLibrarySort,
  libraryView,
  searchDocuments,
  sortDocuments,
} from "@/lib/documents/library";
import type { DocumentSummary } from "@/lib/documents/service";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const doc = (
  id: string,
  title: string,
  excerpt: string,
  wordCount: number,
  updatedAt: string,
): DocumentSummary => ({ id, title, excerpt, wordCount, updatedAt });

const DOCS = [
  doc("a", "Climate essay", "Warming is measured and fast.", 812, "2026-10-03T10:00:00.000Z"),
  doc("b", "Lab report", "We measured river flow twice a day.", 1500, "2026-10-05T10:00:00.000Z"),
  doc("c", "Café notes", "", 40, "2026-10-01T10:00:00.000Z"),
  doc("d", "Essay 10", "The tenth essay.", 812, "2026-10-04T10:00:00.000Z"),
  doc("e", "essay 2", "The second essay.", 300, "2026-10-02T10:00:00.000Z"),
];

const ids = (docs: DocumentSummary[]) => docs.map((d) => d.id);

describe("searchDocuments", () => {
  it("keeps everything for a blank query", () => {
    expect(ids(searchDocuments(DOCS, ""))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(searchDocuments(DOCS, "   "))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("matches the title or the excerpt, ignoring case, accents and extra space", () => {
    expect(ids(searchDocuments(DOCS, "CLIMATE"))).toEqual(["a"]);
    expect(ids(searchDocuments(DOCS, "measured"))).toEqual(["a", "b"]);
    expect(ids(searchDocuments(DOCS, "cafe"))).toEqual(["c"]);
    expect(ids(searchDocuments(DOCS, "Café"))).toEqual(["c"]);
    expect(ids(searchDocuments(DOCS, "  river   flow "))).toEqual(["b"]);
  });

  it("needs every word, in either field and any order", () => {
    expect(ids(searchDocuments(DOCS, "lab twice"))).toEqual(["b"]);
    expect(ids(searchDocuments(DOCS, "twice lab"))).toEqual(["b"]);
    expect(ids(searchDocuments(DOCS, "essay tenth"))).toEqual(["d"]);
  });

  it("does not match across the title and the excerpt, or on what is not there", () => {
    // "essay" + "warming" only meet if the two fields ran together without a break.
    expect(ids(searchDocuments(DOCS, "essaywarming"))).toEqual([]);
    expect(ids(searchDocuments(DOCS, "zebra"))).toEqual([]);
    expect(ids(searchDocuments(DOCS, "climate zebra"))).toEqual([]);
    // Ids and word counts are not text.
    expect(ids(searchDocuments(DOCS, "812"))).toEqual([]);
  });

  it("does not change the list it was given", () => {
    const copy = [...DOCS];
    searchDocuments(DOCS, "essay");
    expect(DOCS).toEqual(copy);
  });

  it("folds text for comparison", () => {
    expect(foldForSearch("  Café  NOTES\n")).toBe("cafe notes");
    expect(foldForSearch("Ångström")).toBe("angstrom");
  });
});

describe("sortDocuments", () => {
  it("Last edited: newest first", () => {
    expect(ids(sortDocuments(DOCS, "edited"))).toEqual(["b", "d", "a", "e", "c"]);
  });

  it("Title A-Z: case and accents ignored, numbers in numeric order", () => {
    expect(ids(sortDocuments(DOCS, "title"))).toEqual(["c", "a", "e", "d", "b"]);
  });

  it("Word count: longest first, ties by last edited", () => {
    // a and d both have 812 words; d was edited later.
    expect(ids(sortDocuments(DOCS, "words"))).toEqual(["b", "d", "a", "e", "c"]);
  });

  it("returns a copy", () => {
    const sorted = sortDocuments(DOCS, "title");
    expect(sorted).not.toBe(DOCS);
    expect(ids(DOCS)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("knows its sort ids", () => {
    for (const id of ["edited", "title", "words"]) expect(isLibrarySort(id)).toBe(true);
    for (const id of ["", "Title", "size", null, 3]) expect(isLibrarySort(id)).toBe(false);
  });

  it("searches, then sorts", () => {
    expect(ids(libraryView(DOCS, "essay", "title"))).toEqual(["a", "e", "d"]);
  });
});

describe("resultCountText", () => {
  it("counts all, or what a search shows of all", () => {
    expect(resultCountText(1, 1)).toBe("1 document");
    expect(resultCountText(5, 5)).toBe("5 documents");
    expect(resultCountText(2, 5)).toBe("2 of 5 documents");
    expect(resultCountText(0, 1)).toBe("0 of 1 document");
    expect(resultCountText(1200, 1200)).toBe("1,200 documents");
  });
});

describe("the library's search and sort", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const titles = () => screen.queryAllByTestId("library-item-title").map((el) => el.textContent);

  it("filters as you type, with a count and a message when nothing matches", () => {
    render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    const search = screen.getByRole("searchbox", { name: "Search documents" });
    const status = screen.getByTestId("library-count");
    expect(status.textContent).toBe("5 documents");
    expect(titles()).toEqual(["Lab report", "Essay 10", "Climate essay", "essay 2", "Café notes"]);

    fireEvent.change(search, { target: { value: "essay" } });
    expect(titles()).toEqual(["Essay 10", "Climate essay", "essay 2"]);
    expect(status.textContent).toBe("3 of 5 documents");

    fireEvent.change(search, { target: { value: "zebra" } });
    expect(titles()).toEqual([]);
    expect(screen.getByText("No documents match “zebra”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(titles()).toHaveLength(5);
    // The button went away with the message; the keyboard is back in the search box.
    expect(document.activeElement).toBe(search);
  });

  it("sorts by the chosen order", () => {
    render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "title" } });
    expect(titles()).toEqual(["Café notes", "Climate essay", "essay 2", "Essay 10", "Lab report"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "words" } });
    expect(titles()).toEqual(["Lab report", "Essay 10", "Climate essay", "essay 2", "Café notes"]);
    const options = within(screen.getByLabelText("Sort by")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Last edited", "Title A-Z", "Word count"]);
  });

  it("remembers the search and the sort in this browser, and applies them on the next visit", () => {
    const { unmount } = render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "essay" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "title" } });
    expect(JSON.parse(localStorage.getItem(LIBRARY_SEARCH_KEY)!)).toEqual({
      user: "user-a",
      query: "essay",
    });
    expect(localStorage.getItem(LIBRARY_SORT_KEY)).toBe("title");
    unmount();

    render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("essay");
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("title");
    expect(titles()).toEqual(["Climate essay", "essay 2", "Essay 10"]);

    // Clearing the search forgets it.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(localStorage.getItem(LIBRARY_SEARCH_KEY)).toBeNull();
  });

  it("never shows one account's search to another, and forgets it on sign-out", () => {
    const { unmount } = render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "climate" } });
    unmount();

    // Someone else signs in on this browser: an empty box, and the other search is dropped.
    const other = render(<DocumentLibrary initialDocuments={DOCS} userId="user-b" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(titles()).toHaveLength(5);
    expect(localStorage.getItem(LIBRARY_SEARCH_KEY)).toBeNull();
    other.unmount();

    // A search from before searches were kept per account (a bare string) is not shown either.
    localStorage.setItem(LIBRARY_SEARCH_KEY, "plagiarism appeal");
    const old = render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    old.unmount();

    // Signing out (SignOutButton) or deleting the account forgets it.
    render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lab" } });
    expect(localStorage.getItem(LIBRARY_SEARCH_KEY)).not.toBeNull();
    forgetSearch();
    expect(localStorage.getItem(LIBRARY_SEARCH_KEY)).toBeNull();
  });

  it("ignores a stored sort it does not know", () => {
    localStorage.setItem(LIBRARY_SORT_KEY, "size");
    render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("edited");
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<DocumentLibrary initialDocuments={DOCS} userId="user-a" />);
    act(() => {
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lab" } });
      fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "words" } });
    });
    expect(titles()).toEqual(["Lab report"]);
  });

  it("has no search controls when there are no documents", () => {
    render(<DocumentLibrary initialDocuments={[]} userId="user-a" />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByText("No documents yet.")).toBeTruthy();
  });
});
