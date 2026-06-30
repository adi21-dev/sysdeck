import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore, useTelemetryStore } from "@/lib/store"

export function useWebSocket() {
  const navigate = useNavigate()
  const wsRef = useRef<WebSocket | null>(null)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setCurrent = useTelemetryStore((s) => s.setCurrent)
  const addToHistory = useTelemetryStore((s) => s.addToHistory)

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${protocol}//${window.location.host}/ws`
    let ws: WebSocket | null = null

    function connect() {
      ws = new WebSocket(url)
      ws.onopen = () => {
        console.log("WS connected")
      }
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.event === "auth_expired") {
            setAuthenticated(false)
            navigate("/login")
            return
          }
          setCurrent(data)
          addToHistory(data)
        } catch {
          // ignore non-json messages
        }
      }
      ws.onclose = () => {
        setTimeout(connect, 3000)
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()
    wsRef.current = ws

    return () => {
      ws?.close()
    }
  }, [navigate, setAuthenticated, setCurrent, addToHistory])
}
