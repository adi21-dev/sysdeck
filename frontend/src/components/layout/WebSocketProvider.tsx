import { useEffect, useState, useRef } from "react"
import type { ReactNode } from "react"
import { useWebSocket } from "@/hooks/use-websocket"
import { useConnectionStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { WifiOff, MonitorDown, RefreshCw } from "lucide-react"

function OfflineOverlay() {
  const status = useConnectionStore((s) => s.status)
  const retry = useConnectionStore((s) => s.retryConnection)
  const [show, setShow] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (status === "disconnected") {
      setReconnecting(false)
      timer.current = setTimeout(() => setShow(true), 1000)
    } else if (status === "offline") {
      setReconnecting(true)
      setShow(true)
    } else {
      setShow(false)
      setReconnecting(false)
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [status])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-2xl flex items-center justify-center animate-fade-in">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-muted/50 backdrop-blur-xl border border-border/50 flex items-center justify-center">
          <WifiOff className="w-8 h-8 text-muted-foreground animate-pulse" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{reconnecting ? "Reconnecting..." : "Connection Lost"}</h2>
        <p className="text-muted-foreground mb-6 text-sm">{reconnecting ? "Attempting to reconnect..." : "The connection to the server was lost"}</p>
        {retry && (
          <Button onClick={() => { setReconnecting(true); retry() }} disabled={reconnecting} className="px-6">
            <RefreshCw className={`h-4 w-4 mr-2 ${reconnecting ? "animate-spin" : ""}`} />
            {reconnecting ? "Reconnecting..." : "Retry Connection"}
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
      <OfflineOverlay />
      <ShuttingDownOverlay />
      {children}
    </>
  )
}
