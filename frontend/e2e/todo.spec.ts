import { expect, test } from "@playwright/test"

// Minimal auth smoke: sign in with the seeded email/password user and confirm
// the authenticated UI renders. Deeper CRUD/chat flows are intentionally left
// out for now. Start the stack with `make dev`. Credentials come from the env:
//
//   E2E_EMAIL=e2e-test@example.com E2E_PASSWORD=testpass123 pnpm e2e
//
// The user is loaded by supabase/seed.sql.
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.describe("auth smoke", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "set E2E_EMAIL / E2E_PASSWORD to the seeded Supabase user",
  )

  test("sign in renders the authenticated UI", async ({ page }) => {
    await page.goto("/")

    await page.getByLabel("Email").fill(EMAIL!)
    await page.getByLabel("Password").fill(PASSWORD!)
    await page.getByRole("button", { name: "Sign in" }).click()

    // Signing in bounces to /chat inside the app shell.
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible()
  })
})
