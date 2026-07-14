import { useAuthStore } from "@/lib/store"

const EXCLUDED_PATHS = ["/login", "/api/auth/refresh", "/api/auth/check", "/api/setup"]
let refreshPromise: Promise<boolean> | null = null
let globalNavigate: ((path: string) => void) | null = null

export function setGlobalNavigate(fn: (path: string) => void) {
  globalNavigate = fn
}

async function refreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => {
      if (r.ok) {
        return true
      }
      return tryClearCookies()
    })
    .catch(() => {
      return tryClearCookies()
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

async function tryClearCookies(): Promise<boolean> {
  document.cookie = "token=; Max-Age=0; Path=/"
  document.cookie = "refresh_token=; Max-Age=0; Path=/api/auth/refresh"
  return false
}

function shouldIntercept(url: string): boolean {
  for (const path of EXCLUDED_PATHS) {
    if (url.includes(path)) return false
  }
  return url.startsWith("/api/")
}

function handleUnauthenticated(): void {
  useAuthStore.getState().setAuthenticated(false)
  if (globalNavigate) globalNavigate("/login")
  else window.location.href = "/login"
}

const originalFetch = window.fetch.bind(window)

window.fetch = async function interceptedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

  if (!shouldIntercept(url)) {
    return originalFetch(input, init)
  }

  let res: Response
  const doFetch = () => originalFetch(input, init)
  res = await doFetch()

  if (res.status === 401) {
    const refreshed = await refreshTokens()
    if (refreshed) {
      res = await doFetch()
      if (res.status === 401) {
        handleUnauthenticated()
        throw new Error("Session expired")
      }
    } else {
      handleUnauthenticated()
      throw new Error("Session expired")
    }
  }

  return res
}
