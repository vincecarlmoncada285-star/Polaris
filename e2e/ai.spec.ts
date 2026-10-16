import { expect, test, type APIRequest, type Page } from "@playwright/test";
import { signUp } from "./helpers";

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
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
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
