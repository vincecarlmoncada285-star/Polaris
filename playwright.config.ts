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
    // CI runs from a clean checkout with no .env. These test-only values are passed to both
    // the build and the server, and win over anything in a local .env.
    env: {
      AUTH_SECRET: "polaris-e2e-only-secret-not-for-real-deployments",
      AUTH_TRUST_HOST: "true",
      // The tests play the part of one reverse proxy: each browser context sends the
      // X-Forwarded-For "its proxy" would have appended (e2e/helpers.ts, switchToFreshIp), so
      // the per-IP rate limits see distinct clients. Without this the header is ignored.
      TRUSTED_PROXY_HOPS: "1",
      // No Anthropic credentials, whatever the shell or a local .env holds: the e2e server can
      // never call Claude. The AI tests intercept /api/ai/paragraph in the browser instead.
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
    },
  },
});
