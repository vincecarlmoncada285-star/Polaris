import { expect, test, type Page } from "@playwright/test";
import { openLibrary, signUp } from "./helpers";

const body = (page: Page) => page.getByLabel("Document body");
const status = (page: Page) => page.getByTestId("save-status");

async function newDocument(page: Page): Promise<string> {
  await openLibrary(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await expect(body(page)).toBeVisible();
  return page.url();
}

test("a long document (over 64 KiB) saves", async ({ page }) => {
  // Browsers refuse keepalive request bodies over 64 KiB: saves of long documents must not use it.
  await signUp(page);
  await newDocument(page);
  await body(page).click();
  const paragraph = "Long documents must save like short ones do, however many words they hold. ";
  await page.keyboard.insertText(paragraph.repeat(1200));
  await expect(status(page)).toHaveText("All changes saved", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("word-count")).toContainText("15,600 words");
});

test("a failed save is retried without a new edit", async ({ page }) => {
  await signUp(page);
  await newDocument(page);
  let refused = 0;
  await page.route("**/api/documents/*", (route) => {
    if (route.request().method() === "PATCH" && refused === 0) {
      refused++;
      return route.fulfill({ status: 503 });
    }
    return route.fallback();
  });
  await body(page).click();
  await page.keyboard.type("Typed while the server was down.");
  await expect(status(page)).toHaveText("Couldn’t save. Retrying…");
  // No more typing: the retry alone saves it.
  await expect(status(page)).toHaveText("All changes saved", { timeout: 10_000 });
  await page.reload();
  await expect(body(page)).toContainText("Typed while the server was down.");
});

test("a second tab's stale save is refused, and the writer chooses which version to keep", async ({
  page,
  context,
}) => {
  await signUp(page);
  const url = await newDocument(page);
  await body(page).click();
  await page.keyboard.type("First draft.");
  await expect(status(page)).toHaveText("All changes saved");

  const other = await context.newPage();
  await other.goto(url);
  await expect(body(other)).toContainText("First draft.");

  // The first tab saves a newer version; the second still has the old one.
  await body(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Edited in tab one.");
  await expect(status(page)).toHaveText("All changes saved");

  await body(other).click();
  await other.keyboard.press("End");
  await other.keyboard.type(" Edited in tab two.");
  const notice = other.getByTestId("conflict-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("changed somewhere else");

  // Nothing was overwritten.
  await page.reload();
  await expect(body(page)).toContainText("Edited in tab one.");
  await expect(body(page)).not.toContainText("Edited in tab two.");

  // Tab two keeps its version on purpose.
  await notice.getByRole("button", { name: "Keep this version" }).click();
  await expect(status(other)).toHaveText("All changes saved");
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(body(page)).toContainText("Edited in tab two.");
  await expect(body(page)).not.toContainText("Edited in tab one.");
});

test("loading the saved version gives up this tab's conflicting edits", async ({
  page,
  context,
}) => {
  await signUp(page);
  const url = await newDocument(page);
  await body(page).click();
  await page.keyboard.type("Start.");
  await expect(status(page)).toHaveText("All changes saved");
  const other = await context.newPage();
  await other.goto(url);
  await expect(body(other)).toContainText("Start.");

  await page.keyboard.type(" Kept.");
  await expect(status(page)).toHaveText("All changes saved");
  await body(other).click();
  await other.keyboard.press("End");
  await other.keyboard.type(" Dropped.");
  const notice = other.getByTestId("conflict-notice");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Load the saved version" }).click();
  await expect(body(other)).toContainText("Start. Kept.");
  await expect(body(other)).not.toContainText("Dropped.");
});

test("Back to a document another tab changed shows the newer text, and does not overwrite it", async ({
  page,
  context,
}) => {
  await signUp(page);
  const url = await newDocument(page);
  await body(page).click();
  await page.keyboard.type("Old text.");
  await expect(status(page)).toHaveText("All changes saved");
  // Leave within the app, so Back restores the page from the router's cache.
  await page.getByRole("link", { name: "Documents" }).first().click();
  await expect(page.locator("section[data-ready]")).toBeVisible();

  const other = await context.newPage();
  await other.goto(url);
  await body(other).click();
  await other.keyboard.press("End");
  await other.keyboard.type(" Newer text.");
  await expect(status(other)).toHaveText("All changes saved");

  await page.goBack();
  await expect(body(page)).toContainText("Old text. Newer text.");
  await body(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" And more.");
  await expect(status(page)).toHaveText("All changes saved");
  await other.reload();
  await expect(body(other)).toContainText("Old text. Newer text. And more.");
});

test("edits that could not be saved are kept in the tab and can be restored", async ({ page }) => {
  await signUp(page);
  const url = await newDocument(page);
  await page.route("**/api/documents/*", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 503 }) : route.fallback(),
  );
  await body(page).click();
  await page.keyboard.type("Written while offline.");
  await expect(status(page)).toHaveText("Couldn’t save. Retrying…");
  // Leaving within the app gives no unload prompt; the tab keeps a copy instead.
  await page.getByRole("link", { name: "Documents" }).first().click();
  await expect(page.locator("section[data-ready]")).toBeVisible();

  await page.unroute("**/api/documents/*");
  await page.goto(url);
  const notice = page.getByTestId("draft-notice");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Restore my edits" }).click();
  await expect(body(page)).toContainText("Written while offline.");
  await expect(status(page)).toHaveText("All changes saved");
  await page.reload();
  await expect(body(page)).toContainText("Written while offline.");
  await expect(page.getByTestId("draft-notice")).toBeHidden();
});

test("signing out while saves fail asks first", async ({ page }) => {
  await signUp(page);
  await newDocument(page);
  await page.route("**/api/documents/*", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 503 }) : route.fallback(),
  );
  await body(page).click();
  await page.keyboard.type("Not saved.");
  await expect(status(page)).toHaveText("Couldn’t save. Retrying…");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  // Declined: still signed in, still on the document.
  await expect(body(page)).toContainText("Not saved.");
  await expect(page).toHaveURL(/\/documents\//);
});
