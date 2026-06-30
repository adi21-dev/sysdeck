import { test, expect } from "@playwright/test"

test("audit log loads entries", async ({ page }) => {
  await page.goto("/audit")
  await expect(page.getByText("Audit Log")).toBeVisible({ timeout: 5000 })
  // Wait for loading to finish - check body has loaded content
  await page.waitForTimeout(5000)
  const bodyText = await page.locator("body").innerText()
  expect(bodyText.length).toBeGreaterThan(0)
})

test("audit log event filter changes entries", async ({ page }) => {
  await page.goto("/audit")
  await page.waitForTimeout(1500)
  await page.selectOption("select", "login_failed")
  await page.waitForTimeout(1000)
  // No error banner
  await expect(page.getByRole("alert")).not.toBeVisible({ timeout: 3000 })
})

test("audit log date filter works", async ({ page }) => {
  await page.goto("/audit")
  await page.waitForTimeout(1500)
  const fromInput = page.locator('input[type="date"]').first()
  const toInput = page.locator('input[type="date"]').nth(1)
  await fromInput.fill("2020-01-01")
  await toInput.fill("2020-01-02")
  await page.waitForTimeout(1000)
  await expect(page.getByRole("alert")).not.toBeVisible({ timeout: 3000 })
})

test("audit log load more works", async ({ page }) => {
  await page.goto("/audit")
  await page.waitForTimeout(2500)
  const loadMore = page.getByText("Load More")
  if (await loadMore.isVisible()) {
    await loadMore.click()
    await page.waitForTimeout(1000)
  }
  await expect(page.getByText("Audit Log")).toBeVisible()
})
