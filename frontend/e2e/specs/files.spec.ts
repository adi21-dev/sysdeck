import { test, expect } from "@playwright/test"

test("files page loads with directory listing", async ({ page }) => {
  await page.goto("/files")
  // Wait for loading to finish — either table or empty state appears
  await expect(page.getByText("File Manager")).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(3000)
  // Should show either a table (has entries) or "This folder is empty"
  const hasTable = await page.locator("table").isVisible().catch(() => false)
  const isEmpty = await page.getByText("This folder is empty").isVisible().catch(() => false)
  expect(hasTable || isEmpty).toBe(true)
})

test("toggle between table and grid view", async ({ page }) => {
  await page.goto("/files")
  await page.waitForTimeout(3000)

  // Click grid toggle button
  await page.locator('button[title="Toggle view"]').click()
  await page.waitForTimeout(500)
  // Table should not be visible
  const hasTable = await page.locator("table").isVisible().catch(() => false)
  expect(hasTable).toBe(false)

  // Click back to table
  await page.locator('button[title="Toggle view"]').click()
  await page.waitForTimeout(500)
  await expect(page.locator("table")).toBeVisible({ timeout: 5000 })
})

test("breadcrumb navigation works", async ({ page }) => {
  await page.goto("/files")
  await page.waitForTimeout(3000)
  // C: should be in breadcrumb
  const breadcrumbC = page.locator("nav").filter({ hasText: "C:" }).first()
  await expect(breadcrumbC).toBeVisible()
})

test("refresh button works", async ({ page }) => {
  await page.goto("/files")
  await page.waitForTimeout(3000)

  // Click refresh button
  await page.locator('button[title="Refresh"]').click()
  await page.waitForTimeout(3000)
  // Should have table or empty state
  const hasTable = await page.locator("table").isVisible().catch(() => false)
  const isEmpty = await page.getByText("This folder is empty").isVisible().catch(() => false)
  expect(hasTable || isEmpty).toBe(true)
})
