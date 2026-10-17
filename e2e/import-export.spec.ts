import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import JSZip from "jszip";
import { alertWith, signUp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signUp(page);
});

const MARKDOWN = `# Climate notes

Warming is **measured** and *fast*, as [the report](https://example.org/report) shows.[^ipcc]

## Causes

- Emissions
  - Coal
- Land use

![A chart](https://example.org/chart.png)

[^ipcc]: IPCC (2021), p. 4.
`;

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function docxFixture(): Promise<Buffer> {
  const doc = new Document({
    footnotes: { 1: { children: [new Paragraph("Field notes, day 3.")] } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Lab report")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Method")] }),
          new Paragraph({
            children: [
              new TextRun("We measured "),
              new TextRun({ text: "carefully", bold: true }),
              new TextRun("."),
              new FootnoteReferenceRun(1),
            ],
          }),
          new Paragraph({
            children: [
              new ImageRun({ type: "png", data: PNG, transformation: { width: 10, height: 10 } }),
            ],
          }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph("Cell")] })] }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const importInput = (page: Page) => page.getByLabel("Import a file");
const body = (page: Page) => page.getByLabel("Document body");

async function documentCount(page: Page): Promise<number> {
  const res = await page.request.get("/api/documents");
  return ((await res.json()) as unknown[]).length;
}

test("import a Markdown file: heading, list, link and footnote, titled from its H1", async ({
  page,
}) => {
  await page.goto("/");
  await importInput(page).setInputFiles({
    name: "climate-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(MARKDOWN),
  });
  await page.waitForURL(/\/documents\//);
  await expect(page.getByLabel("Title")).toHaveValue("Climate notes");
  await expect(body(page).getByRole("heading", { name: "Causes", level: 2 })).toBeVisible();
  await expect(body(page).locator("li")).toHaveText(["EmissionsCoal", "Coal", "Land use"]);
  await expect(body(page).getByRole("link", { name: "the report" })).toHaveAttribute(
    "href",
    "https://example.org/report",
  );
  await expect(body(page).locator("strong")).toHaveText("measured");
  await expect(body(page).locator("sup[data-footnote]")).toHaveText(["1"]);
  await expect(page.getByTestId("footnotes")).toContainText("IPCC (2021), p. 4.");
  await expect(page.getByTestId("import-notice")).toHaveText(
    /Imported from climate-notes\.md\. 1 image was left out\./,
  );
  // Saved as a document: it is there after a reload (the notice is said once).
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Climate notes");
  await expect(page.getByTestId("import-notice")).toHaveCount(0);
});

test("import a Word document, and say what was left out", async ({ page }) => {
  await page.goto("/");
  await importInput(page).setInputFiles({
    name: "lab.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await docxFixture(),
  });
  await page.waitForURL(/\/documents\//);
  await expect(page.getByLabel("Title")).toHaveValue("Lab report");
  await expect(body(page).getByRole("heading", { name: "Method", level: 1 })).toBeVisible();
  await expect(body(page).locator("strong")).toHaveText("carefully");
  await expect(page.getByTestId("footnotes")).toContainText("Field notes, day 3.");
  await expect(body(page)).not.toContainText("Cell");
  await expect(page.getByTestId("import-notice")).toContainText(
    "1 image and 1 table were left out.",
  );
});

test("drop a plain text file on the library to import it", async ({ page }) => {
  await page.goto("/");
  const dataTransfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "field notes.txt", { type: "text/plain" }));
    return dt;
  }, "First paragraph,\nsoft-wrapped.\n\nSecond paragraph.");
  await page.getByTestId("import-drop-zone").dispatchEvent("drop", { dataTransfer });
  await page.waitForURL(/\/documents\//);
  await expect(page.getByLabel("Title")).toHaveValue("field notes");
  await expect(body(page).locator("p")).toHaveText([
    "First paragraph, soft-wrapped.",
    "Second paragraph.",
  ]);
  await expect(page.getByTestId("import-notice")).toHaveText(/Imported from field notes\.txt\./);
});

test("a corrupt .docx shows an error and creates no document", async ({ page }) => {
  await page.goto("/");
  await importInput(page).setInputFiles({
    name: "broken.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK\u0003\u0004 this is not really a Word file"),
  });
  await expect(alertWith(page, "couldn’t read this Word document")).toBeVisible();
  await expect(page).toHaveURL("/");
  expect(await documentCount(page)).toBe(0);
  await expect(page.getByText("No documents yet.")).toBeVisible();

  // An unsupported type is refused before anything is read.
  await importInput(page).setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await expect(
    alertWith(page, "can import Word (.docx), Markdown (.md) and plain text"),
  ).toBeVisible();
  expect(await documentCount(page)).toBe(0);
});

async function writtenDocument(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByLabel("Title").fill("Climate essay");
  await body(page).click();
  await page.keyboard.type("Warming is measured and fast.");
  await page.getByRole("button", { name: "Footnote", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Footnote 1" });
  await dialog.getByLabel("Footnote text").fill("IPCC (2021).");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(body(page).locator("sup[data-footnote]")).toHaveText(["1"]);
}

const contents = async (download: Download) => readFile((await download.path())!);

test("export Markdown and Word from the Export menu", async ({ page }) => {
  await writtenDocument(page);
  const button = page.getByRole("button", { name: "Export", exact: true });
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // Keyboard: Down opens on the first item; Escape closes and returns to the button.
  await button.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Word (.docx)" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Print / Save as PDF" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // Markdown, by keyboard.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Markdown (.md)" })).toBeFocused();
  const [md] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
  expect(md.suggestedFilename()).toBe("climate-essay.md");
  const markdown = (await contents(md)).toString("utf8");
  expect(markdown).toContain("# Climate essay");
  expect(markdown).toContain("Warming is measured and fast.[^1]");
  expect(markdown).toContain("[^1]: IPCC (2021).");

  // Word, by mouse.
  await button.click();
  const [docx] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("menuitem", { name: "Word (.docx)" }).click(),
  ]);
  expect(docx.suggestedFilename()).toBe("climate-essay.docx");
  const zip = await JSZip.loadAsync(await contents(docx));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Warming is measured and fast.");
  expect(xml).toContain('<w:pStyle w:val="Title"/>');
  expect(await zip.file("word/footnotes.xml")!.async("string")).toContain("IPCC (2021).");

  // Plain text.
  await button.click();
  const [txt] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("menuitem", { name: "Plain text (.txt)" }).click(),
  ]);
  expect(txt.suggestedFilename()).toBe("climate-essay.txt");
  expect((await contents(txt)).toString("utf8")).toBe(
    "Climate essay\n\nWarming is measured and fast.[1]\n\nFootnotes\n\n1. IPCC (2021).\n",
  );
});

test("the print stylesheet shows only the document", async ({ page }) => {
  await writtenDocument(page);
  await page.keyboard.type(" We don't know.");
  await expect(page.locator(".polaris-suggestion").first()).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeHidden();
  await expect(page.getByTestId("editor-toolbar")).toBeHidden();
  await expect(page.getByTestId("side-panel")).toBeHidden();
  await expect(page.getByRole("tablist")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(page.getByTestId("word-count")).toBeHidden();
  // The title prints as a heading; the document and its footnotes print in a serif font.
  await expect(page.locator(".polaris-print-title")).toHaveText("Climate essay");
  await expect(body(page)).toBeVisible();
  const font = await body(page).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toMatch(/Georgia|serif/);
  await expect(page.getByTestId("footnotes")).toContainText("IPCC (2021).");
  await expect(page.getByRole("button", { name: "Edit footnote 1" })).toBeHidden();
  // Suggestions are not underlined on paper.
  const decoration = await page
    .locator(".polaris-suggestion")
    .first()
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).toBe("none");

  await page.emulateMedia({ media: "screen" });
  await expect(page.getByTestId("side-panel")).toBeVisible();
});

test("Settings downloads all documents as a zip of Markdown files with a manifest", async ({
  page,
}) => {
  for (const title of ["Essay", "Essay"]) {
    const res = await page.request.post("/api/documents", {
      data: {
        title,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: `Body of ${title}` }] }],
        },
        plainText: `Body of ${title}`,
      },
    });
    expect(res.status()).toBe(201);
  }
  await page.goto("/settings");
  await expect(page.getByText("one Markdown (.md) file per document")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download all my documents" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^polaris-documents-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await JSZip.loadAsync(await contents(download));
  expect(Object.keys(zip.files).sort()).toEqual(["essay-2.md", "essay.md", "manifest.json"]);
  expect(await zip.file("essay.md")!.async("string")).toBe("# Essay\n\nBody of Essay\n");
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  expect(manifest.documents).toHaveLength(2);
  expect(manifest.documents[0]).toMatchObject({ file: "essay.md", title: "Essay", wordCount: 3 });
  await expect(
    page.getByRole("status").filter({ hasText: "Downloaded 2 documents." }),
  ).toBeVisible();
});
