import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

// Cloud containers ship Chromium at a fixed path; use it when present.
const chromiumPath = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3100",
    launchOptions: existsSync(chromiumPath) ? { executablePath: chromiumPath } : {},
  },
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
