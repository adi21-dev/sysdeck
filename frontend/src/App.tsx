import { lazy, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom"
import { AppLayout } from "@/components/layout/AppLayout"
import { ProtectedRoute } from "@/components/layout/ProtectedRoute"
import { useWakeLock } from "@/hooks/use-wake-lock"
import { WebSocketProvider } from "@/components/layout/WebSocketProvider"
import { ToastContainer } from "@/components/ui/toast"
import { LoginPage } from "@/pages/Login"
import { SetupPage } from "@/pages/Setup"
import { InitProgress } from "@/components/InitProgress"
import { setGlobalNavigate } from "@/lib/api"

const OverviewPage = lazy(() => import("@/pages/Overview").then(m => ({ default: m.OverviewPage })))
const DashboardPage = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.DashboardPage })))
const FilesPage = lazy(() => import("@/pages/Files").then(m => ({ default: m.FilesPage })))
const ScriptsPage = lazy(() => import("@/pages/Scripts").then(m => ({ default: m.ScriptsPage })))
const ControlsPage = lazy(() => import("@/pages/Controls").then(m => ({ default: m.ControlsPage })))
const AuditPage = lazy(() => import("@/pages/Audit").then(m => ({ default: m.AuditPage })))
const SettingsPage = lazy(() => import("@/pages/Settings").then(m => ({ default: m.SettingsPage })))
const RemoteDesktopPage = lazy(() => import("@/pages/RemoteDesktop").then(m => ({ default: m.RemoteDesktopPage })))

function RootRedirect() {
  return <InitProgress />
}

function NavigateProvider() {
  const navigate = useNavigate()
  useEffect(() => { setGlobalNavigate(navigate) }, [navigate])
  return null
}

function App() {
  useWakeLock()
  return (
    <BrowserRouter>
      <NavigateProvider />
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
            <Route path="/overview" element={<OverviewPage />} />
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
