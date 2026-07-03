import { useRef, useEffect } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { useConnectionStore } from "@/lib/store"

export default function TerminalTab() {
  const termRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const termRefInstance = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connected = useConnectionStore((s) => s.status === "connected")

  useEffect(() => {
    if (!connected || !termRef.current) return
    let cancelled = false

    const term = new Terminal({ cursorBlink: true, fontSize: 14 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current!)
    termRef.current!.focus()
    fit.fit()
    termRefInstance.current = term
    fitRef.current = fit

    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(termRef.current)

    fetch("/api/terminal/create", { method: "POST" })
      .then((r) => r.json())
      .then((json) => {
        if (!json.success || cancelled) return
        const id = json.id
        const proto = location.protocol === "https:" ? "wss:" : "ws:"
        const ws = new WebSocket(`${proto}//${location.host}/ws/terminal/${id}`)
        wsRef.current = ws

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.event === "terminal_output") term.write(msg.data)
          } catch { /* ignore binary */ }
        }

        ws.onclose = () => {
          if (!cancelled) term.write("\r\n[Connection closed]\r\n")
        }

        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: "terminal_stdin", data }))
          }
        })

        ws.onopen = () => {
          fit.fit()
          const dims = fit.proposeDimensions()
          if (dims) {
            ws.send(JSON.stringify({
              event: "terminal_resize",
              cols: dims.cols,
              rows: dims.rows,
            }))
          }
          term.focus()
        }
      })

    return () => {
      cancelled = true
      ro.disconnect()
      term.dispose()
      wsRef.current?.close()
    }
  }, [connected])

  return (
    <div ref={termRef} className="h-[calc(100vh-12rem)] min-h-48 rounded-xl border" />
  )
}
