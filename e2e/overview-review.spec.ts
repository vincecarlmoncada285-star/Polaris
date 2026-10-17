import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// The e2e server has no Anthropic credentials (playwright.config.ts), so nothing here can reach
// Claude. Where a review is needed, the browser is told the server is configured (/api/me) and
// GET/POST /api/documents/*/review are answered in the browser with a canned review.

const THESIS = "Homework improves learning for every student";
const QUOTE = "a survey of nine students";
const PARAGRAPHS = [
  `${THESIS}, and this essay argues that schools should assign more of it. Teachers in many schools report that regular practice at home helps students remember what they learned in class. Parents often agree, although their reasons differ from those of teachers.`,
  `The main evidence comes from ${QUOTE} at one school. Most of them said that they liked homework and that it helped them prepare for tests. Several also said that homework took too long on some evenings, which made them tired the next day. The survey did not ask how much time each student spent on homework.`,
  "Critics argue that homework adds stress without improving results, especially for younger children. Some studies have found only small effects in primary schools. Others suggest that the quality of homework matters more than the amount. These findings complicate the simple claim that more homework is always better.",
  "Therefore schools should assign more homework at every level, because students who practise more will learn more. Teachers should also explain why each task matters, so that students see homework as part of their learning rather than as a punishment.",
];

async function newDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Writes paragraphs into the editor, one input event per paragraph. */
async function write(page: Page, paragraphs: string[]) {
  await page.getByLabel("Document body").click();
  for (const [i, p] of paragraphs.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.insertText(p);
  }
}

async function enableAi(page: Page) {
  await page.goto("/settings");
  await page.getByRole("switch", { name: "AI suggestions" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "AI suggestions are on." }),
  ).toBeVisible();
}

/** Makes GET /api/me say the server has an Anthropic key, and keeps paragraph checks quiet. */
async function pretendAiConfigured(page: Page) {
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), aiConfigured: true } });
  });
  await page.route("**/api/ai/paragraph", (route) =>
    route.fulfill({ json: { suggestions: [], cached: false } }),
  );
}

const cannedResult = {
  summary:
    "The essay argues that homework helps every student and that schools should assign more.",
  thesis: {
    assessment: "The thesis is clear, but it claims more than the evidence shows.",
    quote: THESIS,
  },
  strengths: ["The essay considers the critics' view before concluding."],
  priorities: [
    {
      title: "Match the claim to the evidence",
      detail: "A survey of nine students at one school cannot show what is true of every student.",
      quote: QUOTE,
      category: "evidence",
    },
    {
      title: "Answer the critics",
      detail: "You describe the critics' findings but your conclusion ignores them.",
      quote: null,
      category: "argument",
    },
  ],
  sections: [{ paragraph: 2, heading: null, note: "Say how the students were chosen." }],
  structure: "The paragraphs follow a clear order.",
  argument: "The conclusion does not follow from one small survey.",
  evidence: "There is one small source of evidence.",
  style: "The register suits an essay.",
};

/**
 * Stands in for the review routes. POST answers (after a pause) with the canned review and
 * remembers the document's saved text; GET returns that review, stale if the saved text has
 * changed since, as the real route computes it. Returns how many reviews were requested.
 */
async function fakeReviewRoutes(page: Page, documentId: string) {
  const state = { posts: 0, reviewedText: null as string | null, createdAt: "" };
  const savedText = async () =>
    (
      (await (await page.request.get(`/api/documents/${documentId}`)).json()) as {
        plainText: string;
      }
    ).plainText;
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  await page.route(`**/api/documents/${documentId}/review`, async (route) => {
    if (route.request().method() === "POST") {
      state.posts++;
      state.reviewedText = await savedText();
      state.createdAt = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route
        .fulfill({
          status: 201,
          json: {
            review: {
              id: "rev_e2e",
              createdAt: state.createdAt,
              model: "claude-opus-5-5",
              wordCount: words(state.reviewedText),
              stale: false,
              result: cannedResult,
            },
          },
        })
        .catch(() => {});
      return;
    }
    if (state.reviewedText === null) {
      return route.fulfill({ status: 404, json: { error: "No review yet.", code: "none" } });
    }
    const stale = (await savedText()) !== state.reviewedText;
    await route.fulfill({
      json: {
        review: {
          id: "rev_e2e",
          createdAt: state.createdAt,
          model: "claude-opus-5-5",
          wordCount: words(state.reviewedText),
          stale,
          result: cannedResult,
        },
      },
    });
  });
  return state;
}

const selection = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test("Overview: metrics update after typing, and a word target shows as progress", async ({
  page,
}) => {
  await signUp(page);
  await newDocument(page);
  await write(page, ["The first sentence is short. The second one is a little longer than that."]);

  await page.getByRole("tab", { name: "Overview" }).click();
  const overview = page.getByRole("tabpanel", { name: "Overview" });
  await expect(overview.getByTestId("metric-words")).toContainText("14");
  await expect(overview.getByTestId("metric-sentences")).toContainText("2");
  // Readability needs more text, and says so.
  await expect(overview.getByTestId("metric-reading-ease")).toContainText("at least 100 words");

  // Typing more: the numbers follow once typing pauses.
  await page.getByLabel("Document body").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" A third one.");
  await expect(overview.getByTestId("metric-sentences")).toContainText("3");
  await expect(overview.getByTestId("metric-words")).toContainText("17");

  // Suggestion counts are numbers per category.
  await expect(overview.getByTestId("suggestion-counts")).toContainText("per 1,000 words");

  // No target yet: no progress bar, and the footer shows the plain count.
  await expect(overview.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByTestId("word-count")).toHaveText(/^17 words · /);

  await page.getByRole("button", { name: "Goals", exact: true }).click();
  const target = page.getByRole("spinbutton", { name: "Target length (words)", exact: true });
  await expect(target).toHaveAccessibleDescription(/^Optional\. A whole number from 50/);
  await target.fill("2000");
  await page.getByRole("button", { name: "Save goals" }).click();

  const progress = overview.getByRole("progressbar", { name: "Target length" });
  await expect(progress).toHaveAttribute("aria-valuenow", "17");
  await expect(progress).toHaveAttribute("aria-valuemax", "2000");
  await expect(overview.getByText("17 of 2,000 words (1%)")).toBeVisible();
  await expect(page.getByTestId("word-count")).toContainText("17 / 2,000 words");

  // Saved with the goals, and the tab is remembered in this browser.
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("17 of 2,000 words (1%)")).toBeVisible();

  // An out-of-range target is refused by the form itself.
  await page.getByRole("button", { name: "Goals", exact: true }).click();
  await page.getByLabel("Target length (words)").fill("10");
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByLabel("Target length (words)")
      .evaluate((el) => (el as HTMLInputElement).validity.valid),
  ).toBe(false);
});

test("Overview: the longest sentence button selects that sentence in the editor", async ({
  page,
}) => {
  await signUp(page);
  await newDocument(page);
  const longest = "This sentence is clearly the longest one that appears anywhere in the draft.";
  await write(page, ["A short one.", `Another. ${longest} Tiny.`]);
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Longest sentence, 13 words" }).click();
  await expect.poll(() => selection(page)).toBe(longest);
});

test("Overview: making a paragraph a heading updates the counts, with no typing", async ({
  page,
}) => {
  await signUp(page);
  await newDocument(page);
  await write(page, ["Introduction", "The first sentence. The second sentence."]);
  await page.getByRole("tab", { name: "Overview" }).click();
  const overview = page.getByRole("tabpanel", { name: "Overview" });
  await expect(overview.getByTestId("metric-sentences")).toContainText("3");

  await page.getByLabel("Document body").getByText("Introduction").click();
  await page.getByRole("button", { name: "Heading 2" }).click();
  await expect(page.getByLabel("Document body").locator("h2")).toHaveText("Introduction");
  // A heading is not a sentence: the Overview follows, though the text is unchanged.
  await expect(overview.getByTestId("metric-sentences")).toContainText("2");
});

test("selecting an underline in the text shows its card, whichever tab was open", async ({
  page,
}) => {
  await signUp(page);
  await newDocument(page);
  await write(page, ["We don't know yet."]);
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("tabpanel", { name: "Suggestions" })).toBeHidden();

  await page.getByLabel("Document body").locator(".polaris-suggestion--formality").click();
  await expect(page.getByRole("tab", { name: "Suggestions" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText(
      "Contractions read as conversational. Most academic style guides prefer the full form.",
    ),
  ).toBeVisible();
  // The writer keeps typing where they were.
  await expect(page.getByLabel("Document body")).toBeFocused();

  // The switch was Polaris's, not the writer's: the Overview they chose is still remembered.
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("panel tabs work with the keyboard", async ({ page }) => {
  await signUp(page);
  await newDocument(page);
  const tabs = page.getByRole("tablist", { name: "Writing tools" });
  await expect(tabs.getByRole("tab")).toHaveText(["Suggestions", "Overview", "Review"]);
  const suggestions = page.getByRole("tab", { name: "Suggestions" });
  await expect(suggestions).toHaveAttribute("aria-selected", "true");

  await suggestions.focus();
  await page.keyboard.press("ArrowRight");
  const overview = page.getByRole("tab", { name: "Overview" });
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Suggestions" })).toBeHidden();

  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Review" })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Review" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(suggestions).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(suggestions).toHaveAttribute("aria-selected", "true");

  // Only the selected tab is in the Tab order: Tab goes on into its panel.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: "Suggestions" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(suggestions).toBeFocused();
});

test("Review: results render, quotes jump into the text, and edits make it stale", async ({
  page,
}) => {
  await signUp(page);
  await enableAi(page);
  await pretendAiConfigured(page);
  const id = await newDocument(page);
  const reviews = await fakeReviewRoutes(page, id);
  await page.getByLabel("Title").fill("Why homework matters");
  await write(page, PARAGRAPHS);

  await page.getByRole("tab", { name: "Review" }).click();
  const panel = page.getByRole("tabpanel", { name: "Review" });
  await expect(panel).toContainText(
    "Polaris sends this whole document with its footnotes, its title and your writing goals to Anthropic's Claude API",
  );
  const start = panel.getByRole("button", { name: "Review document" });
  await expect(start).toBeEnabled();
  await start.click();

  await expect(panel.getByRole("status")).toHaveText(
    "Reviewing your document. This can take a minute or two.",
  );
  await expect(panel.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: /^Reviewed just now · \d+ words$/ }),
  ).toBeVisible();
  expect(reviews.posts).toBe(1);
  // What was reviewed is what the writer sees: the review ran on the saved text.
  expect(reviews.reviewedText).toContain(PARAGRAPHS[3]);

  await expect(panel).toContainText(cannedResult.summary);
  const priorities = panel.getByTestId("review-priorities").getByRole("listitem");
  await expect(priorities).toHaveCount(2);
  await expect(priorities.first()).toContainText("Evidence");
  await expect(priorities.first()).toContainText("Match the claim to the evidence");
  for (const aspect of ["Structure", "Argument", "Evidence", "Style"]) {
    await expect(panel.getByRole("region", { name: aspect })).toBeVisible();
  }
  await expect(panel.getByTestId("review-stale")).toHaveCount(0);

  // Opened again later (the tab is remembered), the review is still current, and can be run
  // again all the same (after a change of goals, say).
  await page.reload();
  await expect(page.getByLabel("Document body")).toContainText(PARAGRAPHS[3]!);
  await expect(panel.getByTestId("review-results")).toBeVisible();
  await expect(panel.getByTestId("review-again").getByRole("button")).toHaveText("Review again");
  await expect(panel.getByTestId("review-stale")).toHaveCount(0);

  // A priority's quote selects that passage in the editor.
  await priorities
    .first()
    .getByRole("button", { name: `Show in text: “${QUOTE}”` })
    .click();
  await expect.poll(() => selection(page)).toBe(QUOTE);

  // A section note's paragraph number selects that paragraph.
  await panel.getByRole("button", { name: "Go to paragraph 2" }).click();
  await expect.poll(() => selection(page)).toBe(PARAGRAPHS[1]);

  // Editing after the review: the banner appears straight away...
  await page.getByLabel("Document body").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" One more sentence.");
  const stale = panel.getByTestId("review-stale");
  await expect(stale).toContainText("You have edited the document since this review.");
  await expect(stale.getByRole("button", { name: "Review again" })).toBeEnabled();

  // ...and reopening the tab (or the page) asks the server, which says the same.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(stale).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("review-stale")).toContainText(
    "You have edited the document since this review.",
  );

  // The quoted passage is rewritten: the review says so instead of selecting something else.
  await page.getByRole("button", { name: "Go to paragraph 2" }).click();
  await expect.poll(() => selection(page)).toBe(PARAGRAPHS[1]);
  await page.keyboard.insertText("The evidence is anecdotal.");
  await expect(page.getByLabel("Document body")).not.toContainText(QUOTE);
  await page
    .getByTestId("review-priorities")
    .getByRole("button", { name: `Show in text: “${QUOTE}”` })
    .click();
  await expect(page.getByText("(this passage has changed)")).toBeVisible();
});

test("Review: the button says why it is disabled for a short document and with AI off", async ({
  page,
}) => {
  await signUp(page);
  await pretendAiConfigured(page);
  const id = await newDocument(page);
  await write(page, ["Only a few words so far."]);
  await page.getByRole("tab", { name: "Review" }).click();
  const panel = page.getByRole("tabpanel", { name: "Review" });

  // AI is off: the reason, with the way to turn it on.
  const start = panel.getByRole("button", { name: "Review document" });
  await expect(start).toBeDisabled();
  await expect(panel.getByTestId("review-blocked")).toHaveText(
    "AI is off. Turn it on in Settings to ask for a review.",
  );
  await expect(panel.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  await expect(start).toHaveAccessibleDescription(/AI is off/);

  // And the real server refuses too, from the stored setting.
  const off = await page.request.post(`/api/documents/${id}/review`);
  expect(off.status()).toBe(403);
  expect(await off.json()).toMatchObject({ code: "ai_disabled" });

  // AI on, but the document is too short.
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await enableAi(page);
  await page.goto(`/documents/${id}`);
  const panelAgain = page.getByRole("tabpanel", { name: "Review" });
  await expect(panelAgain.getByRole("button", { name: "Review document" })).toBeDisabled();
  await expect(panelAgain.getByTestId("review-blocked")).toHaveText(
    "A review needs at least 150 words. This document has 6.",
  );

  // The real server: no review yet, and (no Anthropic key on the e2e server) unavailable.
  const none = await page.request.get(`/api/documents/${id}/review`);
  expect(none.status()).toBe(404);
  expect(await none.json()).toMatchObject({ code: "none" });
  const unconfigured = await page.request.post(`/api/documents/${id}/review`);
  expect(unconfigured.status()).toBe(503);
  expect(await unconfigured.json()).toMatchObject({ code: "ai_unavailable" });
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("the panel stacks below the editor and stays usable", async ({ page }) => {
    await signUp(page);
    await newDocument(page);
    await write(page, ["We don't know yet. This is a test of the phone layout."]);
    const article = await page.locator("article").boundingBox();
    const tablist = page.getByRole("tablist", { name: "Writing tools" });
    const tabs = await tablist.boundingBox();
    expect(tabs!.y).toBeGreaterThan(article!.y + article!.height);
    expect(tabs!.x + tabs!.width).toBeLessThanOrEqual(375);

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByTestId("metric-words")).toContainText("12");
    await page.getByRole("tab", { name: "Review" }).click();
    await expect(page.getByRole("button", { name: "Review document" })).toBeVisible();
    await page.getByRole("tab", { name: "Suggestions" }).click();
    await expect(
      page.getByTestId("suggestion-card").filter({ hasText: "Avoid contractions" }),
    ).toBeVisible();

    // Nothing is wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
  });
});
