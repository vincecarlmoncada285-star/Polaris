import { expect, test } from "@playwright/test";

test("create a document, get feedback, apply it, and persist", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);

  await page.getByLabel("Title").fill("Climate essay");
  const body = page.getByLabel("Document body");
  await body.click();
  await page.keyboard.type("We don't know why the results were very strong (Smith 2020).");

  await expect(page.getByTestId("word-count")).toContainText("11 words");

  const cards = page.getByTestId("suggestion-card");
  await expect(cards.filter({ hasText: "Avoid contractions" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "APA: comma between author and year" })).toHaveCount(1);

  // Underlines are rendered in the editor.
  await expect(body.locator(".polaris-suggestion--formality")).toHaveText("don't");

  await cards
    .filter({ hasText: "Avoid contractions" })
    .getByRole("button", { expanded: false })
    .click();
  await page.getByRole("button", { name: "do not", exact: true }).click();
  await expect(body).toContainText("We do not know");

  await cards.filter({ hasText: "adds little" }).getByRole("button", { expanded: false }).click();
  await page.getByRole("button", { name: "Remove “very”" }).click();
  await expect(body).toContainText("were strong");

  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Climate essay");
  await expect(page.getByLabel("Document body")).toContainText(
    "We do not know why the results were strong (Smith 2020).",
  );

  await page.goto("/");
  await expect(page.getByRole("link", { name: /Climate essay/ })).toBeVisible();
});

test("goals change which citation rules apply", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByLabel("Document body").click();
  await page.keyboard.type("As argued (Smith, 42).");

  const mla = page.getByTestId("suggestion-card").filter({ hasText: "MLA" });
  await expect(mla).toHaveCount(0);

  await page.getByRole("button", { name: "Goals" }).click();
  await page.getByLabel("Citation style").selectOption("mla");
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(mla).toHaveCount(1);
});
