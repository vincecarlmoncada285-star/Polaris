import { expect, test, type APIRequest, type Page } from "@playwright/test";
import { openLibrary, signUp } from "./helpers";

// The e2e server has no Anthropic credentials (playwright.config.ts), so nothing here can reach
// Claude. Where a test needs AI to be available, the browser is told the server is configured
// (/api/me) and POST /api/ai/paragraph is answered in the browser with canned suggestions.

const P1 = "These results prove that the new method works in every case.";
const P2 = "This changed how researchers approach the problem in later studies.";
const AI_NOTE = "Suggested by Claude. Check that it keeps your meaning.";

async function enableAi(page: Page) {
  await page.goto("/settings");
  await page.getByRole("switch", { name: "AI suggestions" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "AI suggestions are on." }),
  ).toBeVisible();
}

/** Makes GET /api/me say the server has an Anthropic key, keeping the rest of the real answer. */
async function pretendAiConfigured(page: Page) {
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), aiConfigured: true } });
  });
}

/**
 * Stands in for the AI route: an overclaim on "prove" (with a fix) and a vague "This" at the
 * start of a paragraph (rephrase only), computed from the request body. Returns the texts sent.
 */
async function fakeAiRoute(page: Page, { delayMs = 0 } = {}) {
  const sent: string[] = [];
  await page.route("**/api/ai/paragraph", async (route) => {
    const { text } = route.request().postDataJSON() as { text: string };
    sent.push(text);
    const suggestions = [];
    const prove = text.indexOf("prove");
    if (prove >= 0) {
      suggestions.push({
        start: prove,
        end: prove + "prove".length,
        category: "clarity",
        message: "Claim is stronger than the evidence",
        explanation: "One study cannot prove a general rule, so readers may doubt the claim.",
        replacements: ["suggest"],
      });
    }
    if (text.startsWith("This ")) {
      suggestions.push({
        start: 0,
        end: 4,
        category: "clarity",
        message: "Unclear what “This” refers to",
        explanation: "Name what changed, so the reader does not have to guess.",
        replacements: [],
      });
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ json: { suggestions, cached: false } }).catch(() => {});
  });
  return sent;
}

/**
 * The real server, as this page's user: bypasses the browser's route interception, and uses a
 * fresh connection (a pooled keep-alive socket left idle during a wait can be reset).
 */
async function serverAs(page: Page, request: APIRequest) {
  return request.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
}

async function newDocument(page: Page) {
  await openLibrary(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
}

/**
 * The writer comes back to this tab. A browser fires visibilitychange and focus then; headless
 * Chromium may not (every page counts as visible and focused), so fire them here.
 */
async function comeBack(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

async function typeParagraphs(page: Page, ...paragraphs: string[]) {
  await page.getByLabel("Document body").click();
  for (const [i, p] of paragraphs.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(p);
  }
}

test("AI suggestions: cards with a badge, underlines, apply, dismiss, and re-checks", async ({
  page,
}) => {
  await signUp(page);
  await enableAi(page);
  await pretendAiConfigured(page);
  const sent = await fakeAiRoute(page, { delayMs: 800 });
  await newDocument(page);
  await typeParagraphs(page, P1, P2);

  const status = page.getByTestId("ai-status");
  await expect(status).toHaveText(/^Checking [12] paragraphs?…$/);

  const cards = page.getByTestId("suggestion-card");
  const overclaim = cards.filter({ hasText: "Claim is stronger than the evidence" });
  const vague = cards.filter({ hasText: "Unclear what “This” refers to" });
  await expect(overclaim).toHaveCount(1);
  await expect(vague).toHaveCount(1);
  await expect(status).toHaveText("");
  expect([...sent].sort()).toEqual([P1, P2].sort());

  // The badge is text, with the caveat as its tooltip; the card names its category too.
  const badge = overclaim.getByText("AI", { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("title", AI_NOTE);
  await expect(overclaim).toContainText("Clarity");

  // Both are underlined in the text, as AI suggestions.
  const body = page.getByLabel("Document body");
  await expect(body.locator(".polaris-suggestion--ai")).toHaveText(["prove", "This"]);

  // A rephrase-only suggestion offers Dismiss and nothing that pretends to fix it.
  await vague.getByRole("button", { expanded: false }).click();
  await expect(vague).toContainText("Name what changed");
  await expect(vague).toContainText(AI_NOTE);
  await expect(vague.getByRole("button")).toHaveText([/Unclear what/, "Dismiss"]);
  await vague.getByRole("button", { name: "Dismiss" }).click();
  await expect(vague).toHaveCount(0);
  await expect(body.locator(".polaris-suggestion--ai")).toHaveText(["prove"]);

  // Applying the replacement edits the text, through the same path as rule fixes.
  await overclaim.getByRole("button", { expanded: false }).click();
  await overclaim.getByRole("button", { name: "suggest", exact: true }).click();
  const P1Fixed = P1.replace("prove", "suggest");
  await expect(body).toContainText(P1Fixed);
  await expect(overclaim).toHaveCount(0);

  // That edit re-checks only the edited paragraph.
  await expect.poll(() => sent.filter((t) => t === P1Fixed).length).toBe(1);

  // So does typing in the other one.
  await body.getByText(P2).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Later work agreed.");
  const P2Edited = `${P2} Later work agreed.`;
  await expect.poll(() => sent.filter((t) => t === P2Edited).length).toBe(1);
  await expect(status).toHaveText("");
  expect(sent).toHaveLength(4);
  expect(sent.filter((t) => t === P1)).toHaveLength(1);
  expect(sent.filter((t) => t === P2)).toHaveLength(1);
  // The dismissed suggestion stays dismissed on the edited paragraph.
  await expect(vague).toHaveCount(0);

  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
});

test("opening a document sends nothing: only paragraphs the writer changes are sent", async ({
  page,
}) => {
  await signUp(page);
  await enableAi(page);
  await pretendAiConfigured(page);
  const sent = await fakeAiRoute(page);
  await newDocument(page);
  await typeParagraphs(page, P1, P2);
  await expect.poll(() => [...sent].sort()).toEqual([P1, P2].sort());
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  // Open it again: the page has forgotten what it sent, but sends none of it.
  await page.reload();
  const body = page.getByLabel("Document body");
  await expect(body).toContainText(P2);
  await page.waitForTimeout(3000);
  expect(sent).toHaveLength(2);

  // Editing one paragraph sends that one, and only it.
  await body.getByText(P1).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Indeed.");
  await expect.poll(() => sent.at(-1)).toBe(`${P1} Indeed.`);
  await page.waitForTimeout(2000);
  expect(sent).toHaveLength(3);
});

test("with AI off, no paragraph is sent and the panel says how to turn it on", async ({
  page,
  playwright,
}) => {
  await signUp(page);
  // Even on a server that could provide AI suggestions.
  await pretendAiConfigured(page);
  const sent = await fakeAiRoute(page);
  await newDocument(page);
  await typeParagraphs(page, P1, P2);

  const status = page.getByTestId("ai-status");
  await expect(status).toHaveText("AI suggestions are off. Turn them on in Settings.");
  await expect(status.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  // Rule suggestions still work.
  await page.keyboard.type(" We don't know.");
  await expect(
    page.getByTestId("suggestion-card").filter({ hasText: "Avoid contractions" }),
  ).toHaveCount(1);

  // Well past the 1.5 s idle wait.
  await page.waitForTimeout(3000);
  expect(sent).toEqual([]);
  await expect(page.locator(".polaris-suggestion--ai")).toHaveCount(0);

  // And the server itself refuses, from the stored setting.
  const server = await serverAs(page, playwright.request);
  const res = await server.post("/api/ai/paragraph", { data: { text: P1, goals: {} } });
  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ code: "ai_disabled" });
  await server.dispose();
});

test("switching AI on or off in Settings in another tab applies when the writer comes back", async ({
  page,
}) => {
  await signUp(page);
  await pretendAiConfigured(page);
  const sent = await fakeAiRoute(page);
  await newDocument(page);
  const status = page.getByTestId("ai-status");
  const body = page.getByLabel("Document body");
  await expect(status).toHaveText("AI suggestions are off. Turn them on in Settings.");
  // Written while AI is off.
  await typeParagraphs(page, P1);

  const settings = await page.context().newPage();
  await enableAi(settings);
  await comeBack(page);
  await expect(status).toHaveText("");

  // What the writer writes from now on is checked; what they wrote with AI off is not sent.
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(P2);
  const vague = page
    .getByTestId("suggestion-card")
    .filter({ hasText: "Unclear what “This” refers to" });
  await expect(vague).toHaveCount(1);
  await page.waitForTimeout(2000);
  expect(sent).toEqual([P2]);

  // Off again in the other tab: back here, the AI cards go and nothing more is sent.
  await settings.bringToFront();
  await settings.getByRole("switch", { name: "AI suggestions" }).click();
  await expect(
    settings.getByRole("status").filter({ hasText: "AI suggestions are off." }),
  ).toBeVisible();
  await comeBack(page);
  await expect(status).toHaveText("AI suggestions are off. Turn them on in Settings.");
  await expect(vague).toHaveCount(0);
  await expect(body.locator(".polaris-suggestion--ai")).toHaveCount(0);
  await body.getByText(P2).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Later work agreed.");
  await page.waitForTimeout(3000);
  expect(sent).toEqual([P2]);
});

test("after the server refuses AI, coming back to the tab starts it again if it is on", async ({
  page,
}) => {
  await signUp(page);
  await enableAi(page);
  await pretendAiConfigured(page);
  const sent = await fakeAiRoute(page);
  // The first request is refused, as if AI had been switched off (and then on again) in another
  // tab meanwhile. Later requests reach the canned route above.
  let refusals = 0;
  await page.route("**/api/ai/paragraph", (route) =>
    refusals++ === 0
      ? route.fulfill({
          status: 403,
          json: { error: "AI suggestions are off.", code: "ai_disabled" },
        })
      : route.fallback(),
  );
  await newDocument(page);
  await typeParagraphs(page, P1);

  const status = page.getByTestId("ai-status");
  await expect(status).toHaveText("AI suggestions are off. Turn them on in Settings.");
  expect(refusals).toBe(1);
  expect(sent).toEqual([]);

  // GET /api/me says AI is on, so the stopped scheduler is replaced.
  await comeBack(page);
  await expect(status).toHaveText("");
  const body = page.getByLabel("Document body");
  await body.getByText(P1).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Indeed.");
  await expect.poll(() => sent).toEqual([`${P1} Indeed.`]);
  await expect(
    page.getByTestId("suggestion-card").filter({ hasText: "Claim is stronger than the evidence" }),
  ).toHaveCount(1);
});

test("if the AI setting cannot be read, the panel says so and the editor asks again", async ({
  page,
}) => {
  await signUp(page);
  await enableAi(page);
  let failuresLeft = 1;
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (failuresLeft-- > 0) return route.fulfill({ status: 500, body: "Internal Server Error" });
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), aiConfigured: true } });
  });
  const sent = await fakeAiRoute(page);
  await newDocument(page);

  const status = page.getByTestId("ai-status");
  await expect(status).toHaveText("AI suggestions unavailable");
  // A few seconds later it asks again, and AI suggestions work.
  await typeParagraphs(page, P1);
  await expect.poll(() => sent, { timeout: 15_000 }).toEqual([P1]);
  await expect(status).toHaveText("");
  await expect(
    page.getByTestId("suggestion-card").filter({ hasText: "Claim is stronger than the evidence" }),
  ).toHaveCount(1);
});

test("on a server without an Anthropic key, a writer with AI off is not sent to Settings", async ({
  page,
}) => {
  await signUp(page);
  await newDocument(page);
  const status = page.getByTestId("ai-status");
  await expect(status).toHaveText("AI suggestions aren’t set up on this server.");
  await expect(status.getByRole("link")).toHaveCount(0);
});

test("on a server without an Anthropic key, AI stays quiet and says why", async ({
  page,
  playwright,
}) => {
  await signUp(page);
  await enableAi(page);
  const sent = await fakeAiRoute(page);
  await newDocument(page);
  await typeParagraphs(page, P1);

  await expect(page.getByTestId("ai-status")).toHaveText(
    "AI suggestions aren’t set up on this server.",
  );
  await page.waitForTimeout(3000);
  expect(sent).toEqual([]);

  const server = await serverAs(page, playwright.request);
  expect(await (await server.get("/api/me")).json()).toMatchObject({
    aiEnabled: true,
    aiConfigured: false,
  });
  const res = await server.post("/api/ai/paragraph", { data: { text: P1, goals: {} } });
  expect(res.status()).toBe(503);
  expect(await res.json()).toMatchObject({ code: "ai_unavailable" });
  await server.dispose();
});
