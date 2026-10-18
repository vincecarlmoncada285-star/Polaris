import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn, signUp, switchToFreshIp, type TestUser } from "./helpers";

/** The same account, signed in on another device (a browser context of its own). */
async function signInElsewhere(browser: Browser, user: TestUser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await switchToFreshIp(page);
  await page.goto("/signin");
  await signIn(page, user.email, user.password);
  await page.waitForURL("/");
  expect((await page.request.get("/api/me")).status()).toBe(200);
  return page;
}

const sessionCookies = async (page: Page) =>
  (await page.context().cookies()).filter((c) => c.name.includes("session-token"));

/** A signed-out device ends up on /signin with its cookie gone, not bounced around. */
async function expectSignedOutOnNavigation(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await sessionCookies(page)).toEqual([]);
}

/** This device is still signed in: pages and the API both accept it. */
async function expectStillSignedIn(page: Page) {
  expect((await page.request.get("/api/me")).status()).toBe(200);
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
}

test("changing the password signs out every other device, and keeps this one", async ({
  page,
  browser,
}) => {
  const user = await signUp(page);
  const other = await signInElsewhere(browser, user);

  await page.goto("/settings");
  const oldCookie = (await sessionCookies(page))[0]?.value;
  await page.getByLabel("Current password").fill(user.password);
  await page.getByLabel("New password", { exact: true }).fill("an even better passphrase");
  await page.getByLabel("Confirm new password").fill("an even better passphrase");
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/me/password")),
    page.getByRole("button", { name: "Change password" }).click(),
  ]);
  expect(response.status()).toBe(204);
  // This device was handed a new session cookie with the change...
  expect(await response.headerValue("set-cookie")).toMatch(/authjs\.session-token=[^;]+/);
  await expect(
    page.getByRole("status").filter({ hasText: "Your other devices have been signed out." }),
  ).toBeVisible();
  expect((await sessionCookies(page))[0]?.value).not.toBe(oldCookie);
  // ...so it stays signed in, after a reload and on another page.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expectStillSignedIn(page);

  // The other device still holds its old, validly signed cookie: the API refuses it...
  expect(await sessionCookies(other)).toHaveLength(1);
  const res = await other.request.get("/api/me");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
  // ...and its next page load signs it out.
  await expectSignedOutOnNavigation(other);
  expect((await other.request.get("/api/documents")).status()).toBe(401);

  // It can sign in again, with the new password only.
  await signIn(other, user.email, "an even better passphrase");
  await other.waitForURL("/");
  await other.context().close();
});

test("'Sign out of all other devices' signs them out and keeps this one", async ({
  page,
  browser,
}) => {
  const user = await signUp(page);
  const other = await signInElsewhere(browser, user);
  // A copy of the other device's cookies, to replay after it has been signed out.
  const staleState = await other.context().storageState();

  await page.goto("/settings");
  const button = page.getByRole("button", { name: "Sign out of all other devices" });
  await expect(button).toHaveAccessibleDescription(/This browser stays signed in/);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/me/sign-out-others")),
    button.click(),
  ]);
  expect(response.status()).toBe(204);
  await expect(
    page.getByRole("status").filter({ hasText: "Signed out of all other devices." }),
  ).toBeVisible();
  await expectStillSignedIn(page);

  // The other device's next navigation signs it out, and its API calls get 401.
  await expectSignedOutOnNavigation(other);
  expect((await other.request.get("/api/me")).status()).toBe(401);

  // Its old cookie stays refused, even when it asks Auth.js to update the session itself.
  const replay = await browser.newContext({ storageState: staleState });
  expect((await replay.request.get("/api/me")).status()).toBe(401);
  const { csrfToken } = (await (await replay.request.get("/api/auth/csrf")).json()) as {
    csrfToken: string;
  };
  await replay.request.post("/api/auth/session", {
    data: { csrfToken, data: { sessionVersion: 1, user: { sessionVersion: 1 } } },
  });
  expect((await replay.request.get("/api/me")).status()).toBe(401);
  const stale = await replay.newPage();
  await expectSignedOutOnNavigation(stale);

  // The password still works: only sessions were revoked.
  await signIn(other, user.email, user.password);
  await other.waitForURL("/");
  await replay.close();
  await other.context().close();
});

test("an editor left open on a signed-out device says so, and saves again after signing in", async ({
  page,
  browser,
}) => {
  const user = await signUp(page);
  const other = await signInElsewhere(browser, user);
  const res = await other.request.post("/api/documents", {
    data: {
      title: "Field notes",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "First line." }] }],
      },
      plainText: "First line.",
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await other.goto(`/documents/${id}`);
  const editorBody = other.getByLabel("Document body");
  await expect(editorBody).toContainText("First line.");

  // This device signs every other one out while the editor there is open.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out of all other devices" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Signed out of all other devices." }),
  ).toBeVisible();

  // The next save there is refused: the editor says why, not "retrying".
  await editorBody.click();
  await other.keyboard.press("End");
  await other.keyboard.type(" Written after the sign-out.");
  const notice = other.getByTestId("signed-out-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveRole("alert");
  await expect(notice).toContainText("You were signed out");
  await expect(other.getByTestId("save-status")).toHaveText("Not saved: you’re signed out.");
  const link = notice.getByRole("link", { name: "Sign in again in a new tab" });
  await expect(link).toHaveAttribute("target", "_blank");

  // Signing in again in a new tab keeps this one, and its next edit saves everything.
  const [signInTab] = await Promise.all([other.context().waitForEvent("page"), link.click()]);
  await signInTab.waitForURL("/signin");
  await signIn(signInTab, user.email, user.password);
  await signInTab.waitForURL("/");
  await signInTab.close();
  await other.bringToFront();
  await editorBody.click();
  await other.keyboard.press("End");
  await other.keyboard.type(" And more.");
  await expect(other.getByTestId("save-status")).toHaveText("All changes saved");
  await expect(notice).toHaveCount(0);
  await other.reload();
  await expect(editorBody).toHaveText("First line. Written after the sign-out. And more.");
  await other.context().close();
});
