import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

/**
 * Each browser context gets its own client address. Sign-up is rate limited per IP (5 an
 * hour) and every test signs up, so without this the suite would trip its own limiter.
 * The e2e server runs with TRUSTED_PROXY_HOPS=1 (playwright.config.ts), so it reads this
 * header as the address a trusted reverse proxy appended; by default the app ignores it.
 */
export async function switchToFreshIp(page: Page): Promise<string> {
  const bytes = randomUUID().replace(/-/g, "").slice(0, 6);
  const ip = `10.${parseInt(bytes.slice(0, 2), 16)}.${parseInt(bytes.slice(2, 4), 16)}.${parseInt(bytes.slice(4, 6), 16)}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

/** Signs up a brand-new user through the form and waits for the library to load. */
export async function signUp(page: Page, overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const id = randomUUID().slice(0, 8);
  const user: TestUser = {
    name: `Writer ${id}`,
    email: `writer-${id}@example.test`,
    password: "correct horse battery staple",
    ...overrides,
  };
  await switchToFreshIp(page);
  await page.goto("/signup");
  await page.getByLabel("Name (optional)").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  return user;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/signin");
}

/** The app's own alert; Next.js also renders a (shadow DOM) route announcer with role=alert. */
export function alertWith(page: Page, text: string | RegExp) {
  return page.getByRole("alert").filter({ hasText: text });
}

/** WCAG contrast ratio between two opaque computed colours such as "rgb(251, 250, 247)". */
export function contrastRatio(a: string, b: string): number {
  const luminance = (colour: string) => {
    const channels = colour
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (channels?.length !== 3) throw new Error(`Not an rgb() colour: ${colour}`);
    const [r, g, b] = channels.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
