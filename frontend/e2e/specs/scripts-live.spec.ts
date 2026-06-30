import { test, expect } from "@playwright/test"

test("run ipconfig in live mode and see streaming output", async ({ page }) => {
  await page.goto("/scripts")

  await page.selectOption("select", "IP Config")
  await page.click("text=Run")

  await expect(page.getByText("Console", { exact: true })).toBeVisible({ timeout: 5000 })

  // In live mode, any output appearing means WS is streaming
  await expect(page.getByText(/\[stdout\]|\[stderr\]|\[system\]|Process completed|WebSocket/)).toBeVisible({ timeout: 25000 })
})
