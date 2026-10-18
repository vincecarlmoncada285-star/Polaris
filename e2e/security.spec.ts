import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { openLibrary, signUp } from "./helpers";

const STATIC_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
};

/** The directives of a Content-Security-Policy header, by name. */
function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name!, values]),
  );
}

/**
 * Collects every CSP violation the page reports, across navigations: the
 * securitypolicyviolation event (listened for before any page script runs) and the console
 * message Chromium logs for a blocked resource.
 */
async function recordViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeBinding("__polarisCspViolation", (_source, text: string) => {
    violations.push(text);
  });
  await page.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (e) => {
        const report = (window as unknown as { __polarisCspViolation?: (t: string) => void })
          .__polarisCspViolation;
        report?.(
          `${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"} on ${e.documentURI}`,
        );
      },
      true,
    );
  });
  page.on("console", (msg) => {
    if (/content.security.policy|securitypolicyviolation/i.test(msg.text())) {
      violations.push(`console: ${msg.text()}`);
    }
  });
  return violations;
}

test("pages get a per-request nonce CSP and the static headers; API responses get the static headers", async ({
  page,
}) => {
  const first = (await page.goto("/signin"))!;
  const csp = first.headers()["content-security-policy"];
  expect(csp).toBeTruthy();
  const policy = directives(csp!);
  expect(policy.get("default-src")).toEqual(["'self'"]);
  const scriptSrc = policy.get("script-src")!;
  expect(scriptSrc).toContain("'self'");
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");
  const nonce = scriptSrc.find((v) => v.startsWith("'nonce-"))?.slice(7, -1);
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  expect(policy.get("font-src")).toEqual(["'self'", "data:"]);
  expect(policy.get("connect-src")).toEqual(["'self'"]);
  expect(policy.get("object-src")).toEqual(["'none'"]);
  expect(policy.get("base-uri")).toEqual(["'self'"]);
  expect(policy.get("form-action")).toEqual(["'self'"]);
  expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  for (const [name, value] of Object.entries(STATIC_HEADERS)) {
    expect(first.headers()[name], name).toBe(value);
  }
  // Off unless POLARIS_HSTS=1 (the e2e server is plain HTTP), and Next.js does not announce itself.
  expect(first.headers()["strict-transport-security"]).toBeUndefined();
  expect(first.headers()["x-powered-by"]).toBeUndefined();

  // Next.js put this response's nonce on the scripts it rendered (browsers hide the attribute,
  // not the property).
  const scriptNonces = await page
    .locator("script")
    .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

  // A fresh nonce for every response.
  const second = (await page.goto("/signin"))!;
  expect(second.headers()["content-security-policy"]).not.toBe(csp);

  // Pages with a dot in the path, such as a 404 for a file name, are pages too.
  const missing = (await page.goto("/no-such-file.txt"))!;
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-security-policy"]).toContain("'strict-dynamic'");

  // API routes and static files: the static headers, but no page CSP work.
  for (const res of [await page.request.get("/api/health"), await page.request.get("/api/me")]) {
    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      expect(res.headers()[name], `${res.url()} ${name}`).toBe(value);
    }
    expect(res.headers()["content-security-policy"]).toBeUndefined();
  }
  const chunk = await page.locator("script[src*='/_next/static/']").first().getAttribute("src");
  const asset = await page.request.get(chunk!);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()["x-content-type-options"]).toBe("nosniff");
});

test("the policy is enforced: a script the server did not nonce is blocked and reported", async ({
  page,
}) => {
  const violations = await recordViolations(page);
  // The sign-in page as the server sent it (its CSP header included), plus an inline script
  // and an inline event handler that an injection bug might have let in.
  await page.route("**/signin", async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      "</body>",
      '<script>window.__injected = "script"</script><img src="/nothing.png" onerror="window.__injected = \'handler\'"></body>',
    );
    await route.fulfill({ response, body: html });
  });
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect.poll(() => violations.length).toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(() => (window as unknown as { __injected?: string }).__injected),
  ).toBeUndefined();
  expect(violations.join("\n")).toMatch(/script-src/);
});

test("nothing Polaris does trips its Content-Security-Policy", async ({ page }) => {
  test.setTimeout(120_000);
  const violations = await recordViolations(page);

  await signUp(page);

  // Import a Markdown file (the converter is loaded on demand).
  await page.getByLabel("Import a file").setInputFiles({
    name: "csp-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# CSP notes\n\nImported text with a [link](https://example.org).[^1]\n\n[^1]: A note.\n",
    ),
  });
  await page.waitForURL(/\/documents\//);
  await expect(page.getByLabel("Title")).toHaveValue("CSP notes");

  // Edit: rule underlines appear as you type.
  const body = page.getByLabel("Document body");
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We don't think the results were very strong.");
  await expect(
    page.getByTestId("suggestion-card").filter({ hasText: "Avoid contractions" }),
  ).toHaveCount(1);

  // A footnote, through its dialog.
  await page.getByRole("button", { name: "Footnote", exact: true }).click();
  const footnote = page.getByRole("dialog", { name: /Footnote/ });
  await footnote.getByLabel("Footnote text").fill("Smith (2020).");
  await footnote.getByRole("button", { name: "Save" }).click();
  await expect(footnote).toBeHidden();

  // A link, through its dialog (Ctrl+K with nothing selected adds the address as text).
  await page.keyboard.press("Control+k");
  const link = page.getByRole("dialog", { name: "Add link" });
  await link.getByLabel("Web address").fill("example.com");
  await link.getByRole("button", { name: "Save link" }).click();
  await expect(link).toBeHidden();
  await expect(body.getByRole("link", { name: "example.com" })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  // Export as Markdown and Word (each converter is loaded on demand), and download them.
  const exportButton = page.getByRole("button", { name: "Export", exact: true });
  for (const [item, extension] of [
    ["Markdown (.md)", ".md"],
    ["Word (.docx)", ".docx"],
  ] as const) {
    await exportButton.click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: item }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`csp-notes${extension}`);
    expect((await readFile((await download.path())!)).length).toBeGreaterThan(0);
  }

  // Print / Save as PDF: the browser's print (a no-op in headless Chromium) with the print
  // stylesheet, which shows the document and none of the controls.
  await exportButton.click();
  await page.getByRole("menuitem", { name: "Print / Save as PDF" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(body).toBeVisible();
  await expect(page.getByTestId("editor-toolbar")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // The Goals dialog.
  await page.getByRole("button", { name: "Goals" }).click();
  await expect(page.getByRole("dialog", { name: "Writing goals" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The Overview and Review tabs.
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("tabpanel", { name: "Overview" })).toContainText("Words");
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByRole("tabpanel", { name: "Review" })).toBeVisible();

  // The keyboard: next suggestion, Escape, and the shortcuts dialog.
  await body.click();
  await page.keyboard.press("Alt+BracketRight");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Import a Word file too (mammoth and JSZip, loaded on demand).
  await openLibrary(page);
  const docx = await Packer.toBuffer(
    new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun("From Word.")] })] }],
    }),
  );
  await page.getByLabel("Import a file").setInputFiles({
    name: "from-word.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });
  await page.waitForURL(/\/documents\//);
  await expect(body).toContainText("From Word.");

  // A new, empty document, with its first-run help.
  await openLibrary(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByRole("button", { name: "Got it" }).click();

  // Settings, and the data export there (JSZip, in the browser).
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const [archive] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download all my documents" }).click(),
  ]);
  expect(archive.suggestedFilename()).toMatch(/\.zip$/);

  // Back to the library, client-side.
  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();

  expect(violations).toEqual([]);
});
