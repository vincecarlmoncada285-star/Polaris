import { expect, test, type Page } from "@playwright/test";
import { openLibrary, signOut, signUp } from "./helpers";

const body = (page: Page) => page.getByLabel("Document body");

/** A document with one paragraph of `text`, made through the API as an import would. */
async function createDocument(page: Page, title: string, text: string): Promise<string> {
  const res = await page.request.post("/api/documents", {
    data: {
      title,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      plainText: text,
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function newDocument(page: Page) {
  await openLibrary(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await expect(body(page)).toBeVisible();
}

const titles = (page: Page) => page.getByTestId("library-item-title");

test("the library filters as you type, sorts, and remembers both", async ({ page }) => {
  await signUp(page);
  // Created oldest first, so "Last edited" lists them in reverse.
  await createDocument(page, "Climate essay", "Warming is measured and fast across the globe.");
  await createDocument(page, "Lab report on rivers", "Rivers flood often.");
  await createDocument(
    page,
    "Annotated bibliography",
    "Twelve sources on coastal erosion, each with a short summary of its method.",
  );
  await createDocument(page, "Café notes", "Short draft.");
  await openLibrary(page);

  const search = page.getByRole("searchbox", { name: "Search documents" });
  const count = page.getByTestId("library-count");
  await expect(count).toHaveText("4 documents");
  await expect(search).toHaveAccessibleDescription("4 documents");
  await expect(titles(page)).toHaveText([
    "Café notes",
    "Annotated bibliography",
    "Lab report on rivers",
    "Climate essay",
  ]);

  // By title, any case, letter by letter.
  await search.pressSequentially("CLIM");
  await expect(titles(page)).toHaveText(["Climate essay"]);
  await expect(count).toHaveText("1 of 4 documents");
  // By the text, and by words in either field in any order.
  await search.fill("measured");
  await expect(titles(page)).toHaveText(["Climate essay"]);
  await search.fill("rivers often");
  await expect(titles(page)).toHaveText(["Lab report on rivers"]);
  // Accents do not matter.
  await search.fill("cafe");
  await expect(titles(page)).toHaveText(["Café notes"]);
  // Nothing matches: said in words, with a way back.
  await search.fill("zebra");
  await expect(titles(page)).toHaveCount(0);
  await expect(count).toHaveText("0 of 4 documents");
  await expect(page.getByText("No documents match “zebra”.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(titles(page)).toHaveCount(4);
  // The button went with the message: the keyboard is back in the search box, not lost.
  await expect(search).toBeFocused();

  const sort = page.getByLabel("Sort by");
  await sort.selectOption({ label: "Title A-Z" });
  await expect(titles(page)).toHaveText([
    "Annotated bibliography",
    "Café notes",
    "Climate essay",
    "Lab report on rivers",
  ]);
  await sort.selectOption({ label: "Word count" });
  await expect(titles(page)).toHaveText([
    "Annotated bibliography",
    "Climate essay",
    "Lab report on rivers",
    "Café notes",
  ]);

  // Both are remembered in this browser.
  await search.fill("o");
  await expect(titles(page)).toHaveCount(4);
  await search.fill("on");
  await expect(titles(page)).toHaveText(["Annotated bibliography", "Lab report on rivers"]);
  await page.reload();
  await expect(page.locator("section[data-ready]")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search documents" })).toHaveValue("on");
  await expect(page.getByLabel("Sort by")).toHaveValue("words");
  await expect(titles(page)).toHaveText(["Annotated bibliography", "Lab report on rivers"]);
  await expect(count).toHaveText("2 of 4 documents");

  // The search is this account's: after signing out, the next person here does not see it.
  await signOut(page);
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("search"))),
  ).toEqual([]);
  await signUp(page);
  await createDocument(page, "Someone else's essay", "Different words.");
  await openLibrary(page);
  await expect(page.getByRole("searchbox", { name: "Search documents" })).toHaveValue("");
  await expect(titles(page)).toHaveText(["Someone else's essay"]);
});

test("Alt+] and Alt+[ move between suggestions; Escape closes the card", async ({ page }) => {
  await signUp(page);
  await newDocument(page);
  await body(page).click();
  const text = "We don't think it was very good. They can't go.";
  await page.keyboard.type(text);
  const cards = page.getByTestId("suggestion-card");
  await expect(cards.filter({ hasText: "Avoid contractions" })).toHaveCount(2);
  // The word-level underlines, in reading order.
  const flagged = await body(page)
    .locator(".polaris-suggestion:not(.polaris-suggestion--span)")
    .allTextContents();
  expect(flagged.length).toBeGreaterThanOrEqual(3);
  expect(flagged[0]).toBe("don't");
  expect(flagged).toContain("very");
  expect(flagged.at(-1)).toBe("can't");

  const selected = () => page.evaluate(() => window.getSelection()?.toString());
  const openCard = cards.filter({ has: page.getByRole("button", { expanded: true }) });

  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Alt+BracketRight");
  await expect.poll(selected).toBe("don't");
  await expect(openCard).toHaveCount(1);
  await expect(openCard).toContainText("“don't”");
  await expect(body(page)).toBeFocused();
  await expect(page.getByTestId("suggestion-nav-status")).toHaveText(
    new RegExp(`^Suggestion 1 of \\d+: Avoid contractions`),
  );

  await page.keyboard.press("Alt+BracketRight");
  await expect.poll(selected).toBe(flagged[1]);
  await expect(openCard).toContainText(`“${flagged[1]}”`);
  await page.keyboard.press("Alt+BracketLeft");
  await expect.poll(selected).toBe("don't");
  // Back from the first wraps round to the last.
  await page.keyboard.press("Alt+BracketLeft");
  await expect.poll(selected).toBe("can't");
  await page.keyboard.press("Alt+BracketRight");
  await expect.poll(selected).toBe("don't");
  // None of this typed anything.
  await expect(body(page)).toHaveText(text);
  // A layout that types a bracket with Alt (Option+5 is "[" on a German Mac) keeps its bracket:
  // the key press is not taken for the shortcut.
  const taken = await body(page).evaluate((el) => {
    const event = new KeyboardEvent("keydown", {
      key: "[",
      code: "Digit5",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(taken).toBe(false);
  await expect.poll(selected).toBe("don't");

  // Escape closes the card and keeps the keyboard in the text, from the panel too.
  await page.keyboard.press("Escape");
  await expect(openCard).toHaveCount(0);
  await expect(body(page)).toBeFocused();
  await page.keyboard.press("Alt+BracketRight");
  await expect(openCard).toHaveCount(1);
  await openCard.getByRole("button", { name: "Dismiss" }).focus();
  await page.keyboard.press("Escape");
  await expect(openCard).toHaveCount(0);
  await expect(body(page)).toBeFocused();
});

test("on a narrow screen, opening a suggestion keeps the page at the text", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await signUp(page);
  // A long document with one contraction in the middle; the panel is under the article.
  const filler = "Rivers carry water and soil from the hills to the sea.";
  const paragraphs = [
    ...Array.from({ length: 12 }, () => filler),
    "We don't know where the river ends.",
    ...Array.from({ length: 12 }, () => filler),
  ];
  const res = await page.request.post("/api/documents", {
    data: {
      title: "Rivers",
      content: {
        type: "doc",
        content: paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      },
      plainText: paragraphs.join("\n\n"),
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/documents/${id}`);
  const flagged = body(page).locator(".polaris-suggestion", { hasText: "don't" });
  await expect(flagged).toHaveCount(1);
  await expect(page.getByTestId("suggestion-card")).toHaveCount(1);
  const openCard = page
    .getByTestId("suggestion-card")
    .filter({ has: page.getByRole("button", { expanded: true }) });

  // A tap on the underline opens its card below the article, and the page stays at the text.
  await flagged.click();
  await expect(openCard).toHaveCount(1);
  await expect(openCard).toContainText("“don't”");
  await page.waitForTimeout(300);
  await expect(flagged).toBeInViewport();
  await expect(openCard).not.toBeInViewport();

  // Alt+] from the top scrolls to the flagged text, and stays there.
  await page.keyboard.press("Escape");
  await expect(openCard).toHaveCount(0);
  await page.keyboard.press("Control+Home");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Alt+BracketRight");
  await expect(openCard).toHaveCount(1);
  await expect(flagged).toBeInViewport();
  await page.waitForTimeout(1000);
  await expect(flagged).toBeInViewport();
  await expect(openCard).not.toBeInViewport();
});

test("the Keyboard shortcuts dialog lists the shortcuts; Shift+? opens it outside text", async ({
  page,
}) => {
  await signUp(page);
  await newDocument(page);
  const button = page.getByRole("button", { name: "Keyboard shortcuts" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  // Linux in the test browser: Ctrl and Alt, and the Mac names are explained.
  await expect(dialog).toContainText("On a Mac, use Cmd for Ctrl and Option for Alt.");
  for (const [action, keys] of [
    ["Bold", "Ctrl+B"],
    ["Add or edit a link", "Ctrl+K"],
    ["Add a footnote", "Ctrl+Alt+F"],
    ["Next suggestion", "Alt+]"],
    ["Previous suggestion", "Alt+["],
    ["Close the open suggestion and return to the text", "Esc"],
    ["Redo", "Ctrl+Shift+ZorCtrl+Y"],
  ]) {
    await expect(dialog.getByRole("row", { name: action, exact: false }).first()).toContainText(
      keys,
    );
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();

  // In the text, "?" is just typed.
  await body(page).click();
  await page.keyboard.type("Why?");
  await expect(dialog).toBeHidden();
  await expect(body(page)).toHaveText("Why?");

  // Anywhere else (here, the title's neighbour: a button), Shift+? opens the dialog.
  await page.getByRole("button", { name: "Goals" }).focus();
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  // Not in the title field either.
  await page.getByLabel("Title").click();
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Title")).toHaveValue("?");
});

test("tab titles name the page, and follow the document title as it is typed", async ({ page }) => {
  await page.goto("/signin");
  await expect(page).toHaveTitle("Sign in · Polaris");
  await page.goto("/signup");
  await expect(page).toHaveTitle("Create an account · Polaris");

  await signUp(page);
  await expect(page).toHaveTitle("Your documents · Polaris");
  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings · Polaris");

  await newDocument(page);
  await expect(page).toHaveTitle("Untitled document · Polaris");
  await page.getByLabel("Title").fill("Climate essay");
  await expect(page).toHaveTitle("Climate essay · Polaris");
  await page.getByLabel("Title").fill("   ");
  await expect(page).toHaveTitle("Untitled document · Polaris");
  await page.getByLabel("Title").fill("Climate essay, revised");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  // The server names it too, before any script runs.
  const html = await (await page.request.get(page.url())).text();
  expect(html).toContain("<title>Climate essay, revised · Polaris</title>");
  await page.reload();
  await expect(page).toHaveTitle("Climate essay, revised · Polaris");

  // Back to the library, client-side.
  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(page).toHaveTitle("Your documents · Polaris");

  // Someone else's document (or none) is not found, and its title is not leaked.
  await page.goto("/documents/not-a-real-id");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Polaris");
});

test("the first-run help shows on a new document until dismissed, in this browser", async ({
  page,
  browser,
}) => {
  await signUp(page);
  await newDocument(page);
  const help = page.getByRole("region", { name: "How Polaris works" });
  await expect(help).toBeVisible();
  await expect(help).toContainText("Underlines appear as you type");
  // This server has no Anthropic key: the card says so rather than send the writer to a
  // Settings switch that would do nothing.
  await expect(help).toContainText(
    "AI suggestions and reviews by Claude aren’t set up on this server.",
  );
  await expect(help).not.toContainText("off until you turn them on");
  await expect(help.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(help).toContainText("Overview");
  await expect(help).toContainText("Review");
  await expect(help).toContainText("Export");
  // It stays while the writer starts typing.
  await body(page).click();
  await page.keyboard.type("A first sentence.");
  await expect(help).toBeVisible();

  // Dismissed from the keyboard: focus goes on to the title, not back to the top of the page.
  await help.getByRole("button", { name: "Got it" }).focus();
  await page.keyboard.press("Enter");
  await expect(help).toBeHidden();
  await expect(page.getByLabel("Title")).toBeFocused();
  await page.reload();
  await expect(body(page)).toBeVisible();
  await expect(page.getByTestId("first-run-help")).toHaveCount(0);
  await newDocument(page);
  await expect(page.getByTestId("first-run-help")).toHaveCount(0);

  // Another browser has not dismissed it, but a document with text in it is not new.
  const other = await browser.newContext({
    storageState: { cookies: await page.context().cookies(), origins: [] },
  });
  const otherPage = await other.newPage();
  const id = await createDocument(otherPage, "Draft", "Some words already.");
  await otherPage.goto(`/documents/${id}`);
  await expect(body(otherPage)).toContainText("Some words already.");
  await expect(otherPage.getByTestId("first-run-help")).toHaveCount(0);
  await openLibrary(otherPage);
  await otherPage.getByRole("button", { name: "New document" }).click();
  await otherPage.waitForURL(/\/documents\//);
  await expect(otherPage.getByRole("region", { name: "How Polaris works" })).toBeVisible();
  await other.close();
});

test("leaving with unsaved changes asks first, and only then", async ({ page }) => {
  await signUp(page);
  await newDocument(page);
  const asks = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await asks()).toBe(false);

  // Saves fail (offline, say): the edit is not on the server.
  await page.route("**/api/documents/*", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 503 }) : route.fallback(),
  );
  await body(page).click();
  await page.keyboard.type("Not saved yet.");
  expect(await asks()).toBe(true);
  await expect(page.getByTestId("save-status")).toHaveText(/Couldn’t save/);
  expect(await asks()).toBe(true);
  // The browser's own prompt, which the test declines: the page stays.
  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();
  expect(page.isClosed()).toBe(false);

  // Saved again: no prompt.
  await page.unroute("**/api/documents/*");
  await page.keyboard.type(" Now it is.");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  expect(await asks()).toBe(false);
});

test("GET /api/health answers without a session, and is not rate limited", async ({
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  for (let i = 0; i < 40; i++) {
    const res = await api.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers()["cache-control"]).toBe("no-store");
  }
  await api.dispose();
});

test("every page has the footer; sign-in and sign-up say what Polaris is", async ({ page }) => {
  for (const path of ["/signin", "/signup"]) {
    await page.goto(path);
    await expect(page.getByTestId("about-polaris")).toHaveText(
      /^Polaris is an open-source writing companion for academic writing\. It underlines .+\.$/,
    );
  }
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Polaris is open source" })).toHaveAttribute(
    "href",
    "https://github.com/vincecarlmoncada285-star/Polaris",
  );
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://github.com/vincecarlmoncada285-star/Polaris#privacy",
  );

  await signUp(page);
  await expect(footer).toBeVisible();
  await newDocument(page);
  await expect(footer).toBeVisible();
  await page.goto("/settings");
  await expect(footer).toBeVisible();
  await page.goto("/nowhere");
  await expect(footer).toBeVisible();
  // Not on paper.
  await page.emulateMedia({ media: "print" });
  await expect(footer).toBeHidden();
});

test("the star icon and theme colours are in the page head", async ({ page }) => {
  await page.goto("/signin");
  const icon = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(icon).toMatch(/^\/icon\.svg/);
  const res = await page.request.get(icon!);
  expect(res.headers()["content-type"]).toContain("image/svg+xml");
  expect(await res.text()).toContain("<svg");
  expect((await page.request.get("/favicon.ico")).status()).toBe(404);
  const themes = await page
    .locator('meta[name="theme-color"]')
    .evaluateAll((els) =>
      els.map((el) => `${el.getAttribute("media")} ${el.getAttribute("content")}`),
    );
  expect(themes).toEqual([
    "(prefers-color-scheme: light) #fbfaf7",
    "(prefers-color-scheme: dark) #141413",
  ]);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /open-source writing companion for academic writing/,
  );
});
