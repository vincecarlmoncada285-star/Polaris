import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
}

/**
 * Waits until the editor has taken in the selection the browser shows. ProseMirror reads a
 * caret placed by a click on the next selectionchange event, which can come after a key press
 * the test sends straight away (a person is never that fast). Peeks at the TipTap instance the
 * editor element carries.
 */
async function selectionSettled(page: Page) {
  await expect
    .poll(() =>
      page.getByLabel("Document body").evaluate((root) => {
        type View = { posAtDOM(node: Node, offset: number): number };
        type State = { selection: { anchor: number; head: number } };
        const editor = (root as unknown as { editor?: { view: View; state: State } }).editor;
        const dom = window.getSelection();
        if (!editor || !dom?.anchorNode || !dom.focusNode) return false;
        const { anchor, head } = editor.state.selection;
        return (
          anchor === editor.view.posAtDOM(dom.anchorNode, dom.anchorOffset) &&
          head === editor.view.posAtDOM(dom.focusNode, dom.focusOffset)
        );
      }),
    )
    .toBe(true);
}

/** Selects `text` in the editor, as dragging over it would. */
async function selectText(page: Page, text: string) {
  await page.getByLabel("Document body").evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${wanted}" is not in the editor`);
  }, text);
  await selectionSettled(page);
}

const markers = (page: Page) => page.getByLabel("Document body").locator("sup[data-footnote]");
const entries = (page: Page) => page.getByTestId("footnotes").getByRole("listitem");

test("insert a footnote, edit it, see its number and the list, and undo it", async ({ page }) => {
  await newDocument(page);
  const body = page.getByLabel("Document body");
  await body.click();
  await page.keyboard.type("Homework helps students learn.");

  await page.getByRole("button", { name: "Footnote", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Footnote 1" });
  await expect(dialog).toBeVisible();
  // The marker is already in the text, numbered, while the dialog is open.
  await expect(markers(page)).toHaveText(["1"]);
  const text = dialog.getByLabel("Footnote text");
  await expect(text).toBeFocused();
  await text.fill("Smith (2020), p. 4.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  // Focus goes back to the text, right after the marker.
  await expect(body).toBeFocused();

  await expect(page.getByRole("heading", { name: "Footnotes" })).toBeVisible();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText("Smith (2020), p. 4.");
  // The marker is described by its footnote's text, and links to its entry.
  const marker = markers(page).getByRole("link", { name: "Footnote 1" });
  await expect(marker).toHaveAccessibleDescription("Smith (2020), p. 4.");
  // Footnote text is not counted.
  await expect(page.getByTestId("word-count")).toContainText("4 words");

  // Edit it from the list.
  await page.getByRole("button", { name: "Edit footnote 1" }).click();
  await expect(dialog.getByLabel("Footnote text")).toHaveValue("Smith (2020), p. 4.");
  await dialog.getByLabel("Footnote text").fill("Smith (2021), p. 7.");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(entries(page).first()).toContainText("Smith (2021), p. 7.");
  await expect(body).toBeFocused();

  // A second footnote, earlier in the text, by keyboard: it becomes 1 and the first becomes 2.
  await body
    .locator("p")
    .first()
    .click({ position: { x: 1, y: 8 } });
  await selectionSettled(page);
  await page.keyboard.press("Control+Alt+f");
  const first = page.getByRole("dialog", { name: "Footnote 1" });
  await first.getByLabel("Footnote text").fill("An earlier note.");
  await first.getByRole("button", { name: "Save" }).click();
  await expect(markers(page)).toHaveText(["1", "2"]);
  await expect(entries(page)).toHaveText([/An earlier note\./, /Smith \(2021\), p\. 7\./]);

  // One undo takes the whole new footnote out again, and the numbers follow.
  await expect(body).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(markers(page)).toHaveText(["1"]);
  await expect(entries(page)).toHaveText([/Smith \(2021\), p\. 7\./]);

  // Saved with the document.
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.reload();
  await expect(markers(page)).toHaveText(["1"]);
  await expect(entries(page)).toHaveText([/Smith \(2021\), p\. 7\./]);

  // The entry links back to its marker in the text, and selects it.
  await page.getByRole("link", { name: "Back to footnote 1 in the text" }).click();
  await expect(markers(page)).toHaveClass(/ProseMirror-selectednode/);
  await expect(body).toBeFocused();

  // Clicking a marker opens it; Delete removes it (and the list with it).
  await markers(page).getByRole("link").click();
  const again = page.getByRole("dialog", { name: "Footnote 1" });
  await expect(again.getByLabel("Footnote text")).toHaveValue("Smith (2021), p. 7.");
  await again.getByRole("button", { name: "Delete" }).click();
  await expect(markers(page)).toHaveCount(0);
  await expect(page.getByTestId("footnotes")).toHaveCount(0);
  await expect(body).toContainText("Homework helps students learn.");
});

test("editing a footnote from the list brings the cursor back into view", async ({ page }) => {
  await newDocument(page);
  const body = page.getByLabel("Document body");
  await body.click();
  await page.keyboard.insertText("A claim that needs a source.");
  await page.getByRole("button", { name: "Footnote", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Footnote 1" });
  await dialog.getByLabel("Footnote text").fill("Smith (2020).");
  await dialog.getByRole("button", { name: "Save" }).click();
  // A long essay after it, so the list is far below the marker.
  await page.keyboard.press("Control+End");
  for (let i = 2; i <= 40; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.insertText(`Paragraph ${i} of a long essay, with words enough for a line.`);
  }
  const edit = page.getByRole("button", { name: "Edit footnote 1" });
  for (const close of ["Save", "Cancel"]) {
    await edit.scrollIntoViewIfNeeded();
    await expect(markers(page).first()).not.toBeInViewport();
    await edit.click();
    if (close === "Save") await dialog.getByLabel("Footnote text").fill("Smith (2021).");
    await dialog.getByRole("button", { name: close }).click();
    await expect(dialog).toBeHidden();
    // Focus is back in the text, after the marker, and the writer can see where.
    await expect(body).toBeFocused();
    await expect(markers(page).first()).toBeInViewport();
  }
  await expect(entries(page).first()).toContainText("Smith (2021).");
});

test("cancelling a new footnote leaves nothing behind", async ({ page }) => {
  await newDocument(page);
  await page.getByLabel("Document body").click();
  await page.keyboard.type("Some text.");
  await page.getByRole("button", { name: "Footnote", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Footnote 1" });
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(markers(page)).toHaveCount(0);
  await expect(page.getByLabel("Document body")).toBeFocused();
});

test("add and remove a link with the link dialog", async ({ page }) => {
  await newDocument(page);
  const body = page.getByLabel("Document body");
  await body.click();
  await page.keyboard.type("Read the report today.");
  // Select "report".
  await page.keyboard.press("End");
  for (let i = 0; i < " today.".length; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "report".length; i++) await page.keyboard.press("Shift+ArrowLeft");

  await page.getByRole("button", { name: "Link", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add link" });
  const url = dialog.getByLabel("Web address");
  await expect(url).toBeFocused();
  // Only http, https and mailto.
  await url.fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Only http, https and mailto");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await url.fill("example.com/report");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog).toBeHidden();

  const link = body.getByRole("link", { name: "report" });
  await expect(link).toHaveAttribute("href", "https://example.com/report");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(link).toHaveAttribute("target", "_blank");

  // A plain click places the cursor in the link (no navigation); Ctrl+K edits it.
  await link.click();
  await expect(page).toHaveURL(/\/documents\//);
  await page.keyboard.press("Control+k");
  const edit = page.getByRole("dialog", { name: "Edit link" });
  await expect(edit.getByLabel("Web address")).toHaveValue("https://example.com/report");
  await edit.getByRole("button", { name: "Remove link" }).click();
  await expect(body.getByRole("link")).toHaveCount(0);
  await expect(body).toContainText("Read the report today.");

  // An empty address removes a link too.
  await selectText(page, "Read");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog", { name: "Add link" })
    .getByLabel("Web address")
    .fill("https://example.org");
  await page.keyboard.press("Enter");
  await expect(body.getByRole("link", { name: "Read" })).toHaveAttribute(
    "href",
    "https://example.org",
  );
  await body.getByRole("link", { name: "Read" }).click();
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit link" }).getByLabel("Web address").fill("");
  await page.keyboard.press("Enter");
  await expect(body.getByRole("link")).toHaveCount(0);
});
