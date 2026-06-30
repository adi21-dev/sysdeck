import type { ReactNode } from "react"
import { useWebSocket } from "@/hooks/use-websocket"
import { useConnectionStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

function OfflineOverlay() {
  const status = useConnectionStore((s) => s.status)
  const retry = useConnectionStore((s) => s.retryConnection)

  if (status !== "disconnected") return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
      <RefreshCw className="h-10 w-10 animate-spin text-muted-foreground" />
      <p className="text-lg font-medium">PC is Offline</p>
      <p className="text-sm text-muted-foreground">Reconnecting...</p>
      {retry && (
        <Button variant="outline" onClick={retry} className="mt-2">
          Retry Connection
        </Button>
      )}
    </div>
  )
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  useWebSocket()
  return (
    <>
      <OfflineOverlay />
      {children}
    </>
  )
}
