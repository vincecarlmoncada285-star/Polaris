import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The e2e server renders in UTC with an en-US default. A reader elsewhere must still get the
// same first render, or React reports a hydration mismatch (and re-renders the whole tree).
test.use({ locale: "de-DE", timezoneId: "Asia/Tokyo" });

test("pages hydrate cleanly in another locale and timezone", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (/hydrat/i.test(err.message)) problems.push(err.message);
  });

  await signUp(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByLabel("Title").fill("Locale check");
  await page.getByLabel("Document body").click();
  await page.keyboard.type("A short paragraph that has a handful of words in it.");

  // A target over 1,000 puts a thousands separator in the server-rendered footer.
  await page.getByRole("button", { name: "Goals" }).click();
  await page.getByLabel("Target length (words)").fill("2000");
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.getByTestId("word-count")).toContainText("/ 2,000");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  await page.reload();
  await expect(page.getByTestId("word-count")).toContainText("/ 2,000");

  // The library renders each document's last-edited time on the server.
  await page.goto("/");
  const edited = page.getByRole("link", { name: /Locale check/ }).locator("time");
  await expect(edited).toBeVisible();
  // After hydration the time is shown in the reader's own timezone, not the server's UTC.
  await expect(edited).not.toContainText("UTC");

  expect(problems).toEqual([]);
});
