import { useEffect, useRef, useCallback } from "react"
import { useTelemetryStore, useConnectionStore, useTunnelStore } from "@/lib/store"

const MAX_RECONNECT_DELAY = 30000

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempts = useRef(0)
  const setCurrent = useTelemetryStore((s) => s.setCurrent)
  const addToHistory = useTelemetryStore((s) => s.addToHistory)
  const setStatus = useConnectionStore((s) => s.setStatus)
  const setRetryConnection = useConnectionStore((s) => s.setRetryConnection)
  const setShuttingDown = useConnectionStore((s) => s.setShuttingDown)
  const setTunnel = useTunnelStore((s) => s.setTunnel)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${protocol}//${window.location.host}/ws`
    let ws: WebSocket | null = null

    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }

    try {
      ws = new WebSocket(url)
    } catch {
      setStatus("disconnected")
      return
    }

    ws.onopen = () => {
      reconnectAttempts.current = 0
      setStatus("connected")
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.event === "system") {
          if (data.data?.type === "shutting_down") {
            setShuttingDown(true)
          }
          return
        }
        if (data.event === "telemetry") {
          setCurrent(data.data)
          addToHistory(data.data)
          return
        }
        if (data.event === "tunnel_status") {
          setTunnel({ status: data.status, url: data.url ?? null })
          return
        }
      } catch {
        // ignore non-json messages
      }
    }

    ws.onclose = (event) => {
      console.log("WS onclose fired", event)
      setStatus("disconnected")
      fetch("/api/auth/refresh", { method: "POST" }).finally(() => {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), MAX_RECONNECT_DELAY)
        reconnectAttempts.current++
        reconnectTimer.current = setTimeout(connect, delay)
      })
    }

    ws.onerror = () => {
      ws?.close()
    }

    wsRef.current = ws
    setRetryConnection(() => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      setStatus("offline")
      setTimeout(connect, 100)
    })
  }, [setCurrent, addToHistory, setStatus, setRetryConnection, setTunnel, setShuttingDown])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      setRetryConnection(null)
    }
  }, [connect, setRetryConnection])
}
