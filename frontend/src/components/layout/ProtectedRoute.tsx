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

  if (checking) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
