import { Outlet, useLocation } from "react-router-dom"
import { Suspense } from "react"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { useAuthStore, useConnectionStore, useTunnelStore, useToastStore } from "@/lib/store"
import { Copy, Check, Loader2 } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

const PAGE_TITLES: Record<string, string> = {
  "/overview":  "Overview",
  "/dashboard": "Dashboard",
  "/files":     "Files",
  "/scripts":   "Scripts",
  "/controls":  "Controls",
  "/audit":     "Audit Log",
  "/settings":  "Settings",
  "/remote":    "Remote Desktop",
}

export function AppLayout() {
  const location = useLocation()
  const status = useConnectionStore((s) => s.status)
  const isLocal = useAuthStore((s) => s.isLocal)
  const tunnelUrl = useTunnelStore((s) => s.url)
  const addToast = useToastStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!tunnelUrl) return
    try {
      await navigator.clipboard.writeText(tunnelUrl)
      setCopied(true)
      addToast("Remote URL copied!", "success")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast("Failed to copy URL", "error")
    }
  }

  const pageTitle = PAGE_TITLES[location.pathname] || "SysDeck"
  const isOverview = location.pathname === "/overview"

  // Connection status styling
  const statusClass =
    status === "connected"    ? "status-connected" :
    status === "disconnected" ? "status-disconnected" :
    "status-offline"

  const statusDotColor =
    status === "connected"    ? "bg-green-500 shadow-[0_0_7px_hsl(142_65%_40%_/_0.6)]" :
    status === "disconnected" ? "bg-amber-400 shadow-[0_0_7px_hsl(38_90%_50%_/_0.6)]" :
    "bg-red-500 shadow-[0_0_7px_hsl(0_68%_48%_/_0.6)]"

  const statusLabel =
    status === "connected"    ? "Connected" :
    status === "disconnected" ? "Reconnecting" :
    "Offline"

  return (
    <div className="flex h-dvh">
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:p-3 focus:bg-background focus:z-[9999] focus:text-foreground focus:font-medium focus:rounded-br-xl"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content */}
      <main
        id="main-content"
        className={cn(
          "flex-1 ml-0 md:ml-60 overflow-auto",
          isOverview ? "pb-0" : "pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))]",
          "md:pb-0"
        )}
      >
        {/* Sticky header */}
        <header className="sticky top-0 z-30 border-b border-border/40 glass-strong">
          <div className="flex items-center justify-between px-4 py-2.5 h-[52px]">
            {/* Page title */}
            <h2 className="text-[15px] font-semibold tracking-tight">{pageTitle}</h2>

            {/* Right side: status + copy URL */}
            <div className="flex items-center gap-2.5">
              {/* Connection status pill */}
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors",
                  statusClass
                )}
              >
                <span
                  className={cn("status-dot w-[7px] h-[7px] rounded-full flex-shrink-0", statusDotColor)}
                  aria-hidden="true"
                />
                <span>{statusLabel}</span>
              </div>

              {/* Copy remote URL — icon on mobile, text on desktop */}
              {isLocal && tunnelUrl && (
                <>
                  {/* Mobile: icon only */}
                  <button
                    onClick={handleCopy}
                    className="md:hidden touch-target rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                    aria-label={copied ? "Remote URL copied" : "Copy remote URL"}
                  >
                    {copied
                      ? <Check className="h-4 w-4 text-green-500" />
                      : <Copy className="h-4 w-4" />
                    }
                  </button>

                  {/* Desktop: full button */}
                  <button
                    onClick={handleCopy}
                    className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-background/50 backdrop-blur-sm text-[12px] font-medium hover:bg-accent hover:border-border transition-all duration-200 active:scale-[0.97]"
                    aria-label={copied ? "Remote URL copied" : "Copy remote URL"}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? "Copied!" : "Remote URL"}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-4 md:p-6 lg:p-8" key={location.pathname}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            }
          >
            <div className="animate-fade-in-up">
              <Outlet />
            </div>
          </Suspense>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  )
}
