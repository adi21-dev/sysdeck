import { useEffect, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore, useTelemetryStore, useConnectionStore } from "@/lib/store"

export function useWebSocket() {
  const navigate = useNavigate()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setCurrent = useTelemetryStore((s) => s.setCurrent)
  const addToHistory = useTelemetryStore((s) => s.addToHistory)
  const setStatus = useConnectionStore((s) => s.setStatus)
  const setRetryConnection = useConnectionStore((s) => s.setRetryConnection)

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
        setCurrent(data)
        addToHistory(data)
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
  }, [navigate, setAuthenticated, setCurrent, addToHistory, setStatus, setRetryConnection])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      setRetryConnection(null)
    }
  }, [connect, setRetryConnection])
}
