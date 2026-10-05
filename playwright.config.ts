import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: isCI,
  // Hard ceiling so a hung browser or server can't burn Actions minutes.
  globalTimeout: isCI ? 5 * 60_000 : undefined,
  // CI would default to dot output, which has no newlines, so GitHub's log
  // shows no progress until the run ends.
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
  },
  // Serve the production build (`npm run build` first). Run Vite's binary
  // directly: behind `npx`, Playwright can't stop the server and teardown hangs.
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --host localhost --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !isCI,
    timeout: 30_000,
  },
});
