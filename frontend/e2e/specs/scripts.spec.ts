import { test, expect } from "@playwright/test"

test("run system info script in wait mode and see output", async ({ page }) => {
  await page.goto("/scripts")

  await page.selectOption("select", "System Info")
  await page.click("text=Wait")
  await page.click("text=Run")

  await expect(page.getByText("Console", { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/Process exited with code/)).toBeVisible({ timeout: 15000 })
})

test("run ipconfig in wait mode and see output", async ({ page }) => {
  await page.goto("/scripts")

  await page.selectOption("select", "IP Config")
  await page.click("text=Wait")
  await page.click("text=Run")

  await expect(page.getByText("Console", { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/Process exited with code/)).toBeVisible({ timeout: 15000 })
})
