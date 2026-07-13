import { useEffect, useState, lazy } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/layout/AppLayout"
import { ProtectedRoute } from "@/components/layout/ProtectedRoute"
import { WebSocketProvider } from "@/components/layout/WebSocketProvider"
import { useAuthStore } from "@/lib/store"
import { ToastContainer } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { LoginPage } from "@/pages/Login"
import { SetupPage } from "@/pages/Setup"

const DashboardPage = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.DashboardPage })))
const FilesPage = lazy(() => import("@/pages/Files").then(m => ({ default: m.FilesPage })))
const ScriptsPage = lazy(() => import("@/pages/Scripts").then(m => ({ default: m.ScriptsPage })))
const ControlsPage = lazy(() => import("@/pages/Controls").then(m => ({ default: m.ControlsPage })))
const AuditPage = lazy(() => import("@/pages/Audit").then(m => ({ default: m.AuditPage })))
const SettingsPage = lazy(() => import("@/pages/Settings").then(m => ({ default: m.SettingsPage })))
const RemoteDesktopPage = lazy(() => import("@/pages/RemoteDesktop").then(m => ({ default: m.RemoteDesktopPage })))

function RootRedirect() {
  const [status, setStatus] = useState<"loading" | "setup" | "login" | "dashboard" | "error">("loading")

  useEffect(() => {
    let cancelled = false
    async function check() {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2000))
        try {
          const res = await fetch("/api/setup/status")
          const data = await res.json()
          if (cancelled) return
          useAuthStore.getState().setSetupComplete(data.is_setup_complete)
          setStatus(!data.is_setup_complete ? "setup" : "login")
          return
        } catch {
          // retry once
        }
      }
      if (!cancelled) setStatus("error")
    }
    check()
    return () => { cancelled = true }
  }, [])

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-4">
        <h1 className="text-xl font-semibold">Cannot reach server</h1>
        <p className="text-muted-foreground text-sm max-w-xs">Make sure the backend is running and try again.</p>
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    )
  }
  if (status === "loading") return null
  if (status === "setup") return <Navigate to="/setup" replace />
  return <Navigate to="/login" replace />
}

function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route
          element={
            <WebSocketProvider>
              <ProtectedRoute />
            </WebSocketProvider>
          }
        >
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/scripts" element={<ScriptsPage />} />
            <Route path="/remote" element={<RemoteDesktopPage />} />
            <Route path="/controls" element={<ControlsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
