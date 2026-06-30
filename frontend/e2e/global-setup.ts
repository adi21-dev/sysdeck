import { chromium, type FullConfig } from "@playwright/test"
import { generateTotp } from "./helpers/totp"

const PASSWORD = "W5$kXp9#mQ2&vB8!"

async function waitForServer(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Server at ${url} not ready within ${timeoutMs}ms`)
}

/** Run the setup wizard via the backend JSON API. Safe to re-run — finish
 *  handler replaces the existing user. */
async function runSetupViaApi(backend: string): Promise<string> {
  const pwRes = await fetch(`${backend}/api/setup/password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!pwRes.ok) throw new Error(`password step: ${pwRes.status} ${await pwRes.text()}`)
  const pw: any = await pwRes.json()
  const token = pw.token
  if (!token) throw new Error(`password step missing token: ${JSON.stringify(pw)}`)

  const totpRes = await fetch(`${backend}/api/setup/totp?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  if (!totpRes.ok) throw new Error(`totp step: ${totpRes.status} ${await totpRes.text()}`)
  const totp: any = await totpRes.json()
  const secret = totp.secret
  if (!secret) throw new Error(`totp step missing secret: ${JSON.stringify(totp)}`)

  const code = generateTotp(secret)
  const verifyRes = await fetch(
    `${backend}/api/setup/verify-totp?token=${token}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    },
  )
  if (!verifyRes.ok) throw new Error(`verify-totp step: ${verifyRes.status} ${await verifyRes.text()}`)
  const verify: any = await verifyRes.json()
  const token2 = verify.token
  if (!token2) throw new Error(`verify-totp step missing token: ${JSON.stringify(verify)}`)

  const rcRes = await fetch(`${backend}/api/setup/recovery-codes?token=${token2}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  if (!rcRes.ok) throw new Error(`recovery-codes step: ${rcRes.status} ${await rcRes.text()}`)

  const finRes = await fetch(`${backend}/api/setup/finish?token=${token2}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  if (!finRes.ok) throw new Error(`finish step: ${finRes.status} ${await finRes.text()}`)

  return secret
}

export default async function globalSetup(_config: FullConfig) {
  const backend = "http://localhost:3939"
  await waitForServer(`${backend}/api/setup/status`)
  await waitForServer("http://localhost:5173")

  // Always run the wizard via API — idempotent since finish replaces user
  const secretB32 = await runSetupViaApi(backend)

  // Small pause to let backend persist the new user
  await new Promise((r) => setTimeout(r, 500))

  // Log in via browser UI to capture cookies for test isolation
  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL: "http://localhost:5173" })
  await page.goto("/login")
  await page.waitForURL("**/login")
  await page.fill('input[type="password"]', PASSWORD)
  const totpCode = generateTotp(secretB32)
  await page.fill('input[inputMode="numeric"]', totpCode)
  await page.click('button[type="submit"]')
  await page.waitForURL("**/dashboard", { timeout: 15000 })
  await page.context().storageState({ path: ".auth/user.json" })
  await browser.close()
}
