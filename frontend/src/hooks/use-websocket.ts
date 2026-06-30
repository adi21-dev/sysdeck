import { useEffect, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore, useTelemetryStore, useConnectionStore, useTunnelStore } from "@/lib/store"

export function useWebSocket() {
  const navigate = useNavigate()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setCurrent = useTelemetryStore((s) => s.setCurrent)
  const addToHistory = useTelemetryStore((s) => s.addToHistory)
  const setStatus = useConnectionStore((s) => s.setStatus)
  const setRetryConnection = useConnectionStore((s) => s.setRetryConnection)
  const setTunnel = useTunnelStore((s) => s.setTunnel)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${protocol}//${window.location.host}/ws`
    let ws: WebSocket | null = null

    try {
      ws = new WebSocket(url)
    } catch {
      setStatus("disconnected")
      return
    }

    ws.onopen = () => {
      setStatus("connected")
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.event === "auth_expired") {
          setAuthenticated(false)
          navigate("/login")
          return
        }
        if (data.event === "telemetry") {
          setCurrent(data.data)
          addToHistory(data.data)
          return
        }
        if (data.event === "tunnel_status") {
          setTunnel({ status: data.status, url: data.url ?? null, error: data.error ?? null })
          return
        }
      } catch {
        // ignore non-json messages
      }
    }

    ws.onclose = () => {
      setStatus("disconnected")
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws?.close()
    }

    wsRef.current = ws
    setRetryConnection(() => connect)
  }, [navigate, setAuthenticated, setCurrent, addToHistory, setStatus, setRetryConnection, setTunnel])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      setRetryConnection(null)
    }
  }, [connect, setRetryConnection])
}
