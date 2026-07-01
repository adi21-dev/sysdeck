import { Outlet, useLocation } from "react-router-dom"
import { Menu } from "lucide-react"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { useAuthStore, useConnectionStore, useTunnelStore, useToastStore } from "@/lib/store"
import { Copy, Check } from "lucide-react"
import { useState } from "react"

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/files": "Files",
  "/scripts": "Scripts",
  "/controls": "Controls",
  "/audit": "Audit Log",
  "/settings": "Settings",
}

export function AppLayout() {
  const location = useLocation()
  const status = useConnectionStore((s) => s.status)
  const indicator = status === "connected"
    ? "bg-green-500"
    : status === "disconnected"
      ? "bg-yellow-500"
      : "bg-red-500"
  const isLocal = useAuthStore((s) => s.isLocal)
  const tunnelUrl = useTunnelStore((s) => s.url)
  const addToast = useToastStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!tunnelUrl) return
    try {
      await navigator.clipboard.writeText(tunnelUrl)
      setCopied(true)
      addToast("URL copied to clipboard!", "success")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast("Failed to copy URL", "error")
    }
  }

  const pageTitle = PAGE_TITLES[location.pathname] || "Dashboard"

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-60 overflow-auto pb-16 md:pb-0">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <button className="md:hidden p-2 -ml-2 rounded-lg hover:bg-accent" onClick={() => addToast("Use bottom navigation", "info")}>
                <Menu className="h-5 w-5" />
              </button>
              <h2 className="text-lg font-semibold">{pageTitle}</h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border">
                <span className={`status-dot w-2 h-2 rounded-full ${indicator}`} />
                <span className="text-xs font-medium hidden sm:inline">
                  {status === "connected" ? "Connected" : status === "disconnected" ? "Reconnecting" : "Offline"}
                </span>
              </div>
              {isLocal && tunnelUrl && (
                <button
                  onClick={handleCopy}
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-background text-sm font-medium hover:bg-accent transition-colors"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy Remote URL"}
                </button>
              )}
            </div>
          </div>
        </header>
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
