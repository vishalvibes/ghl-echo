import path from "path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    // Playwright owns ./e2e; keep it out of the Vitest (jsdom) run.
    exclude: ["**/node_modules/**", "e2e/**"],
    // Each test file gets a fresh module registry via vi.resetModules() in
    // suites that touch module singletons (see auth-session-cache tests).
  },
  resolve: {
    // Mirror tsconfig paths: @/* -> ./src/*
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
