import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { BottomNav } from "./BottomNav"
import { useAuthStore, useConnectionStore, useTunnelStore, useToastStore } from "@/lib/store"
import { Copy, Check } from "lucide-react"
import { useState } from "react"

export function AppLayout() {
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

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto pb-16 md:pb-0 relative">
        <div className="sticky top-2 right-2 z-40 flex justify-end gap-2 px-4 pointer-events-none">
          {isLocal && tunnelUrl && (
            <button
              onClick={handleCopy}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur px-3 py-1 text-xs text-muted-foreground border shadow-xs hover:bg-accent transition-colors"
              title="Copy Remote URL"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied!" : "Copy Remote URL"}
            </button>
          )}
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur px-3 py-1 text-xs text-muted-foreground border shadow-xs">
            <span className={`h-2 w-2 rounded-full ${indicator}`} />
            {status === "connected" ? "Connected" : status === "disconnected" ? "Reconnecting" : "Offline"}
          </div>
        </div>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
