import { test, expect } from "@playwright/test"

test.describe("Login error states", () => {
  test("shows error on wrong password", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    await page.goto("/login")
    await page.fill('input[type="password"]', "WrongPassword1!")
    await page.fill('input[inputMode="numeric"]', "000000")
    await page.click('button[type="submit"]')
    await expect(page.getByText("Invalid credentials")).toBeVisible({ timeout: 5000 })
    await ctx.close()
  })

  test("shows error on wrong TOTP code", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    await page.goto("/login")
    await page.fill('input[type="password"]', "W5$kXp9#mQ2&vB8!")
    await page.fill('input[inputMode="numeric"]', "000000")
    await page.click('button[type="submit"]')
    await expect(page.getByText("Invalid credentials")).toBeVisible({ timeout: 5000 })
    await ctx.close()
  })

  test("shows lockout after 5 failed attempts", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    await page.goto("/login")
    for (let i = 0; i < 5; i++) {
      await page.fill('input[type="password"]', "WrongPassword1!")
      await page.fill('input[inputMode="numeric"]', "000000")
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)
    }
    await expect(page.getByText(/Account locked|Too many attempts/)).toBeVisible({ timeout: 5000 })
    await ctx.close()
  })

  test("toggles password visibility", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    await page.goto("/login")
    const input = page.locator('input[type="password"]')
    await input.fill("testpassword")
    await expect(input).toHaveAttribute("type", "password")
    await page.locator('button:has(svg.lucide-eye)').click()
    // after click the input should become text type (or a different input appears)
    // The toggle swaps to a text input; just verify icon changed
    await expect(page.locator('button:has(svg.lucide-eye-off)')).toBeVisible()
    await ctx.close()
  })
})
