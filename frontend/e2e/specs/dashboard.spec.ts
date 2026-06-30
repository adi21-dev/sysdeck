import { test, expect } from "@playwright/test"

test("dashboard shows metric cards", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page.getByText("CPU", { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText("RAM", { exact: true })).toBeVisible()
  await expect(page.getByText("Temperature", { exact: true })).toBeVisible()
  await expect(page.getByText("Disk", { exact: true })).toBeVisible()
})

test("dashboard shows network chart", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page.getByText("Network I/O", { exact: true })).toBeVisible({ timeout: 5000 })
})

test("sidebar navigation links work", async ({ page }) => {
  await page.goto("/dashboard")
  await page.click("text=Files")
  await expect(page).toHaveURL(/\/files/)
})
