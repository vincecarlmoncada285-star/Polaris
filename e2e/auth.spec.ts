import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { alertWith, signIn, signOut, signUp, switchToFreshIp } from "./helpers";

test("signed-out visitors are sent to sign in, and APIs answer 401", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/signin?callbackUrl=%2F");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/documents/anything");
  await expect(page).toHaveURL("/signin?callbackUrl=%2Fdocuments%2Fanything");
  await page.goto("/settings");
  await expect(page).toHaveURL("/signin?callbackUrl=%2Fsettings");

  // API routes do not rely on middleware; they check the session themselves.
  for (const [method, path] of [
    ["GET", "/api/documents"],
    ["POST", "/api/documents"],
    ["GET", "/api/documents/anything"],
    ["PATCH", "/api/documents/anything"],
    ["DELETE", "/api/documents/anything"],
    ["GET", "/api/me"],
    ["PATCH", "/api/me"],
    ["DELETE", "/api/me"],
    ["POST", "/api/me/password"],
  ]) {
    const res = await page.request.fetch(path, { method, data: {} });
    expect(res.status(), `${method} ${path}`).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  }
});

test("sign up, write, sign out, sign in: the document is still listed", async ({ page }) => {
  const user = await signUp(page);
  await expect(page.getByTestId("nav-user")).toHaveText(`Signed in as ${user.name}`);

  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByLabel("Title").fill("Persistence check");
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  // Signed-in users have no business on the sign-in and sign-up pages.
  await page.goto("/signin");
  await expect(page).toHaveURL("/");
  await page.goto("/signup");
  await expect(page).toHaveURL("/");

  await signOut(page);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await page.goto("/");
  await expect(page).toHaveURL("/signin?callbackUrl=%2F");

  await signIn(page, user.email.toUpperCase(), user.password);
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: /Persistence check/ })).toBeVisible();
});

test("after signing in, visitors land where they were going", async ({ page }) => {
  const user = await signUp(page);
  await signOut(page);

  await page.goto("/settings");
  await expect(page).toHaveURL("/signin?callbackUrl=%2Fsettings");
  await signIn(page, user.email, user.password);
  await page.waitForURL("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("a forged off-site callbackUrl is ignored", async ({ page }) => {
  const user = await signUp(page);
  await signOut(page);

  await page.goto("/signin?callbackUrl=%2F%2Fevil.example%2Fphish");
  await signIn(page, user.email, user.password);
  await page.waitForURL("/");
  expect(new URL(page.url()).host).toBe("localhost:3100");
});

test("another user's document is a 404, in the page and in the API", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  await signUp(alice);
  await alice.getByRole("button", { name: "New document" }).click();
  await alice.waitForURL(/\/documents\//);
  await alice.getByLabel("Title").fill("Alice's private draft");
  await expect(alice.getByTestId("save-status")).toHaveText("All changes saved");
  const docPath = new URL(alice.url()).pathname;
  const docId = docPath.split("/").pop()!;

  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await signUp(bob);

  const res = await bob.goto(docPath);
  expect(res?.status()).toBe(404);
  await expect(bob.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(bob.getByText("Alice's private draft")).toHaveCount(0);

  const api = `/api/documents/${docId}`;
  const get = await bob.request.get(api);
  expect(get.status()).toBe(404);
  expect(await get.json()).toEqual({ error: "Not found" });
  expect((await bob.request.patch(api, { data: { title: "Bob was here" } })).status()).toBe(404);
  expect((await bob.request.delete(api)).status()).toBe(404);
  expect(await (await bob.request.get("/api/documents")).json()).toEqual([]);

  // Alice's document survived Bob's attempts, unchanged.
  await alice.reload();
  await expect(alice.getByLabel("Title")).toHaveValue("Alice's private draft");

  await aliceContext.close();
  await bobContext.close();
});

test("sign-in errors are generic, and repeated attempts are rate limited", async ({ page }) => {
  test.setTimeout(90_000);
  const user = await signUp(page); // Its automatic sign-in is attempt 1 of 10 for this email.
  await signOut(page);

  const incorrect = alertWith(page, "Email or password is incorrect");
  // Unknown email and wrong password get the same message.
  await signIn(page, "nobody-here@example.test", user.password);
  await expect(incorrect).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("nobody-here@example.test");

  for (let attempt = 2; attempt <= 10; attempt++) {
    await signIn(page, user.email, `wrong password ${attempt}`);
    await expect(incorrect).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  }

  // The 11th attempt in the window is refused before the password is even checked.
  await signIn(page, user.email, user.password);
  await expect(alertWith(page, "Too many attempts. Try again later.")).toBeVisible();
  await expect(page).toHaveURL(/\/signin/);

  // The limit is per email and IP: the same person from another address can still sign in.
  await switchToFreshIp(page);
  await signIn(page, user.email, user.password);
  await page.waitForURL("/");
});

test("sign-up validates input and refuses a taken email", async ({ page }) => {
  const user = await signUp(page);
  await signOut(page);
  await switchToFreshIp(page);

  await page.goto("/signup");
  await page.getByLabel("Email").fill("new-writer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long enough password");
  await page.getByLabel("Confirm password").fill("a different password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(alertWith(page, "Passwords do not match.")).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email")).toHaveValue("new-writer@example.test");

  await page.getByLabel("Email").fill(user.email.toUpperCase());
  await page.getByLabel("Password", { exact: true }).fill("long enough password");
  await page.getByLabel("Confirm password").fill("long enough password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(alertWith(page, "An account with this email already exists.")).toBeVisible();
  await expect(page).toHaveURL("/signup");
});

test("signing out straight after typing still saves the last edit", async ({ page }) => {
  const user = await signUp(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  const docPath = new URL(page.url()).pathname;

  await page.getByLabel("Document body").click();
  await page.keyboard.type("Typed just before signing out.");
  // Still inside the autosave debounce: nothing has been sent yet.
  await expect(page.getByTestId("save-status")).toHaveText("Unsaved changes");
  await signOut(page);

  await page.goto(docPath);
  await signIn(page, user.email, user.password);
  await page.waitForURL(docPath);
  await expect(page.getByLabel("Document body")).toContainText("Typed just before signing out.");
});

test("after a failed sign-in, keyboard focus stays on the submit button", async ({ page }) => {
  await switchToFreshIp(page);
  await page.goto("/signin");
  await page.getByLabel("Email").fill("nobody-at-all@example.test");
  await page.getByLabel("Password", { exact: true }).fill("not a real password");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
  await expect(submit).toBeFocused();
});

test("if signing in after sign-up is refused, the sign-in page says the account exists", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await switchToFreshIp(page);
  const email = `eager-${randomUUID().slice(0, 8)}@example.test`;
  const password = "correct horse battery staple";

  // Ten guesses at an email that has no account yet use up its sign-in allowance on this IP.
  await page.goto("/signin");
  for (let attempt = 1; attempt <= 10; attempt++) {
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/signin",
      ),
      signIn(page, email, `guess number ${attempt}`),
    ]);
    await expect(alertWith(page, "Email or password is incorrect")).toBeVisible();
    // Back to "Sign in" (not "Signing in…"): the attempt is over and React has reset the form,
    // so the next fill is not wiped by that reset.
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  }

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("/signin?created=1");
  await expect(
    page.getByRole("status").filter({ hasText: "Your account was created. Sign in to continue." }),
  ).toBeVisible();

  // The account is real: from another address it signs in straight away.
  await switchToFreshIp(page);
  await signIn(page, email, password);
  await page.waitForURL("/");
});

test("form fields keep a visible focus indicator in forced-colors mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/signin");
  const email = page.getByLabel("Email");
  await email.focus();
  // Forced colours drop box-shadow rings, so an outline must remain for the system to colour.
  expect(await email.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
});

test("the navbar fits a 375px-wide phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await signUp(page, { name: "Maria Salomea Skłodowska-Curie" });

  const nav = page.getByRole("navigation", { name: "Main" });
  for (const control of [
    nav.getByRole("link", { name: "Polaris" }),
    nav.getByTestId("nav-user"),
    nav.getByRole("link", { name: "Settings" }),
    nav.getByRole("button", { name: "Sign out" }),
  ]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
