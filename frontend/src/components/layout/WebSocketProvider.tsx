import { useEffect, useState, useRef } from "react"
import type { ReactNode } from "react"
import { useWebSocket } from "@/hooks/use-websocket"
import { useConnectionStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { WifiOff, MonitorDown, RefreshCw } from "lucide-react"

function ReconnectBanner() {
  const status = useConnectionStore((s) => s.status)
  const retry = useConnectionStore((s) => s.retryConnection)
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (status === "disconnected") {
      timer.current = setTimeout(() => setShow(true), 3000)
    } else {
      setShow(false)
    }
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [status])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-yellow-500/10 backdrop-blur-xl border-b border-yellow-500/20 px-4 py-2 flex items-center justify-center gap-2 text-sm">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      <span>Connection lost. Reconnecting...</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={() => retry()} className="ml-2 h-7 text-xs">
          Retry Now
        </Button>
      )}
    </div>
  )
}

function OfflineOverlay() {
  const status = useConnectionStore((s) => s.status)
  const retry = useConnectionStore((s) => s.retryConnection)

  if (status !== "offline") return null

  return (
    <div className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-2xl flex items-center justify-center animate-fade-in">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-muted/50 backdrop-blur-xl border border-border/50 flex items-center justify-center">
          <WifiOff className="w-8 h-8 text-muted-foreground animate-pulse" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Connection Lost</h2>
        <p className="text-muted-foreground mb-6 text-sm">Unable to reconnect to the server</p>
        {retry && (
          <Button onClick={() => retry()} className="px-6">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry Connection
          </Button>
        )}
      </div>
    </div>
  )
}

function ShuttingDownOverlay() {
  const shuttingDown = useConnectionStore((s) => s.shuttingDown)

  if (!shuttingDown) return null

  return (
    <div className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-2xl flex items-center justify-center animate-fade-in">
      <div className="text-center max-w-sm">
        <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-muted/50 backdrop-blur-xl border border-border/50 flex items-center justify-center">
          <MonitorDown className="w-10 h-10 text-muted-foreground animate-pulse" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">SysDeck is shutting down</h2>
        <p className="text-muted-foreground text-sm">The remote system is powering off</p>
      </div>
    </div>
  )
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  useWebSocket()
  return (
    <>
      <ReconnectBanner />
      <OfflineOverlay />
      <ShuttingDownOverlay />
      {children}
    </>
  )
}
