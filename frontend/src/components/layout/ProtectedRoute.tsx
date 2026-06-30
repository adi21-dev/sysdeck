import { useEffect, useState } from "react"
import { Navigate, Outlet } from "react-router-dom"
import { useAuthStore } from "@/lib/store"

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const [checking, setChecking] = useState(!isAuthenticated)

  useEffect(() => {
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
  }, [isAuthenticated, setAuthenticated])

  if (checking) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}
