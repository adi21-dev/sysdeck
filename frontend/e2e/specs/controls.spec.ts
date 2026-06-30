import { test, expect } from "@playwright/test"

test("control cards are visible", async ({ page }) => {
  await page.goto("/controls")
  await expect(page.getByText("Shutdown")).toBeVisible({ timeout: 5000 })
  await expect(page.getByText("Restart")).toBeVisible()
  await expect(page.getByText("Sleep")).toBeVisible()
})
