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
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          setAuthenticated(true)
        }
        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [isAuthenticated, setAuthenticated, setLocal])

  if (checking) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
