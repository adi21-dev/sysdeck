import { useEffect, useState } from "react"
import { Navigate, Outlet } from "react-router-dom"
import { useAuthStore } from "@/lib/store"

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLocal = useAuthStore((s) => s.setLocal)
  const [checking, setChecking] = useState(!isAuthenticated)

  useEffect(() => {
    setLocal(true)
    fetch("/api/admin/check")
      .then((r) => r.json())
      .then((data) => setLocal(data.is_local))
      .catch(() => {})

    if (isAuthenticated) {
      setChecking(false)
      return
    }

    async function checkAuth() {
      const res = await fetch("/api/auth/check")
      const data = await res.json()
      if (data.authenticated) {
        setAuthenticated(true)
        setChecking(false)
        return
      }
      // Auth check failed — try refresh before giving up
      const refreshRes = await fetch("/api/auth/refresh", { method: "POST" })
      if (refreshRes.ok) {
        const retryRes = await fetch("/api/auth/check")
        const retryData = await retryRes.json()
        if (retryData.authenticated) {
          setAuthenticated(true)
        }
      }
      setChecking(false)
    }

    checkAuth()
  }, [isAuthenticated, setAuthenticated, setLocal])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), var(--background)" }}>
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
