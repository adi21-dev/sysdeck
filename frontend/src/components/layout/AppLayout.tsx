import { Outlet, useLocation } from "react-router-dom"
import { Suspense } from "react"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { useAuthStore, useConnectionStore, useTunnelStore, useToastStore } from "@/lib/store"
import { Copy, Check, Loader2 } from "lucide-react"
import { useState } from "react"

const PAGE_TITLES: Record<string, string> = {
  "/overview": "Overview",
  "/dashboard": "Dashboard",
  "/files": "Files",
  "/scripts": "Scripts",
  "/controls": "Controls",
  "/audit": "Audit Log",
  "/settings": "Settings",
  "/remote": "Remote Desktop",
}

export function AppLayout() {
  const location = useLocation()
  const status = useConnectionStore((s) => s.status)
  const indicator = status === "connected"
    ? "bg-green-500 shadow-[0_0_8px_hsl(142_70%_45%_/_0.5)]"
    : status === "disconnected"
      ? "bg-yellow-500 shadow-[0_0_8px_hsl(40_90%_50%_/_0.5)]"
      : "bg-red-500 shadow-[0_0_8px_hsl(0_80%_55%_/_0.5)]"
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
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:p-3 focus:bg-background focus:z-50 focus:text-foreground focus:font-medium">
        Skip to content
      </a>
      <Sidebar />
      <main id="main-content" className={`flex-1 ml-0 md:ml-60 overflow-auto ${location.pathname === "/overview" ? "pb-0" : "pb-16"} md:pb-0`}>
        <header className="sticky top-0 z-30 border-b bg-background/60 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold tracking-tight">{pageTitle}</h2>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 backdrop-blur-sm border border-border/50">
                <span className={`status-dot w-2 h-2 rounded-full ${indicator}`} />
                <span className="text-xs font-medium hidden sm:inline">
                  {status === "connected" ? "Connected" : status === "disconnected" ? "Reconnecting" : "Offline"}
                </span>
              </div>
              {isLocal && tunnelUrl && (
                <button
                  onClick={handleCopy}
                  className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-background/50 backdrop-blur-sm text-sm font-medium hover:bg-accent transition-all duration-200 active:scale-[0.97]"
                  aria-label={copied ? "Remote URL copied" : "Copy remote URL"}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy Remote URL"}
                </button>
              )}
            </div>
          </div>
        </header>
        <div className="p-4 md:p-6 lg:p-8" key={location.pathname}>
          <Suspense fallback={
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
            </div>
          }>
            <div className="animate-fade-in-up">
              <Outlet />
            </div>
          </Suspense>
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
