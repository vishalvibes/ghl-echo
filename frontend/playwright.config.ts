import { defineConfig, devices } from "@playwright/test"

// E2E config. Tests live in ./e2e. Against the local stack the app runs on
// :3000 — set E2E_BASE_URL to point elsewhere (e.g. a preview deploy).
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuse a running `make frontend`; otherwise boot `pnpm dev` for the run.
  // Requires the rest of the stack (Supabase + backend) already up via `make dev`.
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
