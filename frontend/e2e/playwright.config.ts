import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    storageState: ".auth/user.json",
  },
  webServer: [
    {
      command: "cargo run --bin nodedesk-agent",
      port: 3939,
      cwd: "../../backend",
      timeout: 180000,
      reuseExistingServer: true,
    },
    {
      command: "npx vite --port 5173",
      port: 5173,
      timeout: 30000,
      reuseExistingServer: true,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
})
