import type { ReactNode } from "react"
import { useWebSocket } from "@/hooks/use-websocket"

export function WebSocketProvider({ children }: { children: ReactNode }) {
  useWebSocket()
  return <>{children}</>
}
