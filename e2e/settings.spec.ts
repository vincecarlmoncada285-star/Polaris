import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { alertWith, contrastRatio, signIn, signOut, signUp } from "./helpers";

test("the AI setting persists across a reload", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL("/settings");

  const toggle = page.getByRole("switch", { name: "AI suggestions" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAccessibleDescription(/sends the paragraph you are working on/);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "AI suggestions are on." }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: "AI suggestions" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await (await page.request.get("/api/me")).json()).toMatchObject({ aiEnabled: true });

  await page.getByRole("switch", { name: "AI suggestions" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "AI suggestions are off." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "AI suggestions" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("renaming updates the navbar", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings");
  await page.getByLabel("Display name").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(page.getByTestId("nav-user")).toHaveText("Signed in as Ada Lovelace");

  // A blank name falls back to the email. Wait for the save before reloading, or the reload
  // can cancel it.
  await page.getByLabel("Display name").fill("");
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/me") && r.request().method() === "PATCH"),
    page.getByRole("button", { name: "Save name" }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("nav-user")).toContainText("@example.test");
});

test("changing the password needs the current one", async ({ page }) => {
  const user = await signUp(page);
  await page.goto("/settings");

  await page.getByLabel("Current password").fill("not my password");
  await page.getByLabel("New password", { exact: true }).fill("an even better passphrase");
  await page.getByLabel("Confirm new password").fill("an even better passphrase");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(alertWith(page, "Current password is incorrect.")).toBeVisible();
  // Keyboard users stay where they were rather than being thrown back to the top of the page.
  await expect(page.getByRole("button", { name: "Change password" })).toBeFocused();

  await page.getByLabel("Current password").fill(user.password);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();

  await signOut(page);
  await signIn(page, user.email, user.password);
  await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
  await signIn(page, user.email, "an even better passphrase");
  await page.waitForURL("/");
});

test("deleting the account needs the email typed, then signs out", async ({ page }) => {
  const user = await signUp(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  const docId = new URL(page.url()).pathname.split("/").pop();

  await page.goto("/settings");
  const confirm = page.getByLabel("Type your account email to confirm");
  const deleteButton = page.getByRole("button", { name: "Delete my account" });
  await expect(deleteButton).toBeDisabled();
  await confirm.fill("someone-else@example.test");
  await expect(deleteButton).toBeDisabled();
  await confirm.fill(user.email);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/me") && r.request().method() === "DELETE"),
    deleteButton.click(),
  ]);
  expect(response.status()).toBe(204);
  // The DELETE response itself clears the session cookie.
  expect(await response.headerValue("set-cookie")).toMatch(/authjs\.session-token=;/);

  await page.waitForURL("/signin");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.includes("session-token"))).toEqual([]);
  expect((await page.request.get(`/api/documents/${docId}`)).status()).toBe(401);

  await signIn(page, user.email, user.password);
  await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
});

test("a session whose account was deleted elsewhere is signed out, not stuck", async ({
  page,
  browser,
}) => {
  const user = await signUp(page);

  // The same account, signed in on a second device.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto("/signin");
  await signIn(other, user.email, user.password);
  await other.waitForURL("/");

  await page.goto("/settings");
  await page.getByLabel("Type your account email to confirm").fill(user.email);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await page.waitForURL("/signin");

  // The second device still holds a signed JWT. It must end up signed out on /signin
  // (not bounced between / and /signin), and the API must refuse it.
  expect((await other.request.get("/api/me")).status()).toBe(401);
  await other.goto("/");
  await expect(other).toHaveURL("/signin");
  await expect(other.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await other.goto("/signin");
  await expect(other).toHaveURL("/signin");

  await otherContext.close();
});

test("a repeated password mismatch is announced each time and marks the field", async ({
  page,
}) => {
  await signUp(page);
  await page.goto("/settings");
  await page.getByLabel("Current password").fill("whatever it is");
  await page.getByLabel("New password", { exact: true }).fill("an even better passphrase");
  await page.getByLabel("Confirm new password").fill("a different passphrase");
  const submit = page.getByRole("button", { name: "Change password" });
  await submit.click();

  const mismatch = alertWith(page, "New passwords do not match.");
  await expect(mismatch).toBeVisible();
  const confirm = page.getByLabel("Confirm new password");
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  await expect(confirm).toHaveAccessibleDescription(/New passwords do not match/);

  // The same mistake again must be a fresh alert, or screen readers stay silent.
  await mismatch.evaluate((el) => el.setAttribute("data-seen", ""));
  await submit.click();
  await expect(mismatch).toBeVisible();
  await expect(page.locator("[role=alert][data-seen]")).toHaveCount(0);
});

test("the AI switch is clearly visible when off, in light and dark mode", async ({ page }) => {
  await signUp(page);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/settings");
    const toggle = page.getByRole("switch", { name: "AI suggestions" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const colours = await toggle.evaluate((el) => {
      const track = el.querySelector(":scope > span")!;
      const thumb = track.firstElementChild!;
      const style = (e: Element) => getComputedStyle(e);
      return {
        card: style(el.closest("section")!).backgroundColor,
        trackBorder: style(track).borderTopColor,
        trackFill: style(track).backgroundColor,
        thumb: style(thumb).backgroundColor,
      };
    });
    // WCAG 1.4.11: a control's boundary and its state indicator need 3:1.
    expect(contrastRatio(colours.trackBorder, colours.card), colorScheme).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colours.thumb, colours.trackFill), colorScheme).toBeGreaterThanOrEqual(3);
  }
});

test("settings fit a 375px-wide phone, even with a long email", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  const email = `christopher.alexander.montgomery.${randomUUID().slice(0, 8)}@students.university.example.test`;
  await signUp(page, { email });
  await page.goto("/settings");
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  for (const section of await page.locator("main section").all()) {
    const box = (await section.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
