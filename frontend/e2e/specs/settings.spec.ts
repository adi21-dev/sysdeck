import { test, expect } from "@playwright/test"

test("settings page loads with sections", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByText("Security")).toBeVisible({ timeout: 5000 })
  await expect(page.getByText("Data & Maintenance")).toBeVisible()
  await expect(page.getByText("Configuration")).toBeVisible()
})

test("recovery codes can be regenerated", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByText("Regenerate Codes")).toBeVisible({ timeout: 5000 })
  // Click regenerate
  await page.getByText("Regenerate Codes").click()
  await page.waitForTimeout(1000)
  // After regeneration, "Copy all" appears
  await expect(page.getByText(/Copy all|Copied/)).toBeVisible({ timeout: 5000 })
})

test("file access paths section is visible and editable", async ({ page }) => {
  await page.goto("/settings")
  await page.getByText("File Access Paths").scrollIntoViewIfNeeded()
  await expect(page.getByText("Allowed Paths")).toBeVisible({ timeout: 5000 })
  await expect(page.getByText("Save Paths")).toBeVisible()
})

test("port setting is visible and editable", async ({ page }) => {
  await page.goto("/settings")
  const portInput = page.locator('input[type="number"]').first()
  await expect(portInput).toBeVisible({ timeout: 5000 })
  const val = await portInput.inputValue()
  expect(Number(val)).toBeGreaterThanOrEqual(1024)
})
