import { useEffect, useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/layout/AppLayout"
import { ProtectedRoute } from "@/components/layout/ProtectedRoute"
import { WebSocketProvider } from "@/components/layout/WebSocketProvider"
import { useAuthStore } from "@/lib/store"
import { LoginPage } from "@/pages/Login"
import { SetupPage } from "@/pages/Setup"
import { DashboardPage } from "@/pages/Dashboard"
import { FilesPage } from "@/pages/Files"
import { ScriptsPage } from "@/pages/Scripts"
import { ControlsPage } from "@/pages/Controls"
import { AuditPage } from "@/pages/Audit"
import { SettingsPage } from "@/pages/Settings"

function RootRedirect() {
  const [status, setStatus] = useState<"loading" | "setup" | "login" | "dashboard">("loading")
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        useAuthStore.getState().setSetupComplete(data.is_setup_complete)
        if (!data.is_setup_complete) {
          setStatus("setup")
        } else if (!isAuthenticated) {
          setStatus("login")
        } else {
          setStatus("dashboard")
        }
      })
      .catch(() => setStatus("setup"))
  }, [isAuthenticated])

  if (status === "loading") return null
  if (status === "setup") return <Navigate to="/setup" replace />
  if (status === "login") return <Navigate to="/login" replace />
  return <Navigate to="/dashboard" replace />
}

function App() {
  return (
    <BrowserRouter>
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
