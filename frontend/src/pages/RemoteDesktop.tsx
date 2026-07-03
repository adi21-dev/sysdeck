import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react"
import { useConnectionStore, useToastStore } from "@/lib/store"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const TerminalTab = lazy(() => import("./TerminalTab"))

type Tab = "trackpad" | "keyboard" | "clipboard" | "vision" | "browser" | "windows" | "terminal" | "disks" | "processes" | "sessions"

export function RemoteDesktopPage() {
  const [tab, setTab] = useState<Tab>("trackpad")
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Remote Desktop</h1>
        <LockButton />
      </div>
      <div className="flex gap-2 flex-wrap">
        {(["trackpad", "keyboard", "clipboard", "vision", "browser", "windows", "terminal", "disks", "processes", "sessions"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "trackpad" && <TrackpadTab />}
      {tab === "keyboard" && <KeyboardTab />}
      {tab === "clipboard" && <ClipboardTab />}
      {tab === "vision" && <VisionTab />}
      {tab === "browser" && <BrowserTab />}
      {tab === "windows" && <WindowsTab />}
      <div className={tab === "terminal" ? "" : "hidden"}>
        <Suspense fallback={<Card className="h-[calc(100vh-12rem)] flex items-center justify-center text-muted-foreground">Loading terminal...</Card>}>
          <TerminalTab />
        </Suspense>
      </div>
      {tab === "disks" && <DisksTab />}
      {tab === "processes" && <ProcessesTab />}
      {tab === "sessions" && <SessionsTab />}
    </div>
  )
}

// ── Trackpad ──

function TrackpadTab() {
  const padRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const connected = useConnectionStore((s) => s.status === "connected")

  const api = useCallback((path: string, body: any) =>
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), [])

  const handleDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!connected) return
    dragging.current = true
    let btn = "left"
    if ("button" in e && e.button === 2) btn = "right"
    api("/api/input/mouse/click", { button: btn, double: e.detail === 2 })
  }, [api, connected])

  const handleMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging.current) return
    let dx = 0, dy = 0
    if ("movementX" in e) {
      dx = e.movementX * 2
      dy = e.movementY * 2
    } else if ("touches" in e && e.touches.length > 0 && padRef.current) {
      // ponytail: basic touch delta. Multi-touch gestures not implemented.
      const touch = e.touches[0]
      const rect = padRef.current.getBoundingClientRect()
      dx = (touch.clientX - rect.left - rect.width / 2) * 2
      dy = (touch.clientY - rect.top - rect.height / 2) * 2
    }
    if (dx !== 0 || dy !== 0) {
      api("/api/input/mouse/move", { x: dx, y: dy, relative: true }).catch(() => {})
    }
  }, [api, connected])

  const handleUp = useCallback(() => {
    dragging.current = false
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!connected) return
    api("/api/input/mouse/scroll", { dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) })
  }, [api, connected])

  const clickButton = useCallback((btn: string, double = false) => {
    if (!connected) return
    api("/api/input/mouse/click", { button: btn, double })
  }, [api, connected])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div
          ref={padRef}
          className="w-full h-64 bg-muted rounded-lg cursor-crosshair select-none border-2 border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground"
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {!connected ? "Disconnected" : "Drag to move · Click to click · Scroll to scroll"}
        </div>
      </Card>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => clickButton("left")}>Left Click</Button>
        <Button size="sm" onClick={() => clickButton("right")}>Right Click</Button>
        <Button size="sm" onClick={() => clickButton("middle")}>Middle Click</Button>
        <Button size="sm" onClick={() => clickButton("left", true)}>Double Click</Button>
      </div>
    </div>
  )
}

// ── Keyboard ──

function KeyboardTab() {
  const [text, setText] = useState("")
  const connected = useConnectionStore((s) => s.status === "connected")

  const sendType = useCallback(async () => {
    if (!text || !connected) return
    await fetch("/api/input/keyboard/type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    setText("")
  }, [text, connected])

  const sendHotkey = useCallback(async (keys: string[]) => {
    if (!connected) return
    await fetch("/api/input/keyboard/press", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    })
  }, [connected])

  const sendMedia = useCallback(async (key: string) => {
    if (!connected) return
    await fetch("/api/input/keyboard/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    })
  }, [connected])

  const hotkeys = [
    { label: "Ctrl+C", keys: ["ctrl", "c"] },
    { label: "Ctrl+V", keys: ["ctrl", "v"] },
    { label: "Ctrl+X", keys: ["ctrl", "x"] },
    { label: "Ctrl+A", keys: ["ctrl", "a"] },
    { label: "Ctrl+Z", keys: ["ctrl", "z"] },
    { label: "Ctrl+S", keys: ["ctrl", "s"] },
    { label: "Alt+Tab", keys: ["alt", "tab"] },
    { label: "Ctrl+Shift+Esc", keys: ["ctrl", "shift", "esc"] },
    { label: "Win+D", keys: ["meta", "d"] },
    { label: "Win+E", keys: ["meta", "e"] },
  ]

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-medium">Type Text</h3>
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendType() }}
            placeholder="Type something..."
            className="flex-1"
          />
          <Button onClick={sendType} disabled={!connected}>Send</Button>
        </div>
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-medium">Hotkeys</h3>
        <div className="flex gap-2 flex-wrap">
          {hotkeys.map((h) => (
            <Button key={h.label} size="sm" variant="outline" onClick={() => sendHotkey(h.keys)} disabled={!connected}>
              {h.label}
            </Button>
          ))}
        </div>
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-medium">Media Keys</h3>
        <div className="flex gap-2 flex-wrap">
          {["play_pause", "next", "prev", "volume_up", "volume_down", "mute"].map((k) => (
            <Button key={k} size="sm" variant="outline" onClick={() => sendMedia(k)} disabled={!connected}>
              {k.replace("_", " ")}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Clipboard ──

function ClipboardTab() {
  const [clipText, setClipText] = useState("")
  const [remoteText, setRemoteText] = useState("")
  const addToast = useToastStore((s) => s.addToast)
  const connected = useConnectionStore((s) => s.status === "connected")

  const fetchClipboard = useCallback(async () => {
    if (!connected) return
    const res = await fetch("/api/clipboard")
    const json = await res.json()
    if (json.success && json.data?.text) {
      setRemoteText(json.data.text)
    }
  }, [connected])

  const setClipboard = useCallback(async () => {
    if (!clipText || !connected) return
    await fetch("/api/clipboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clipText }),
    })
    setClipText("")
    addToast("Clipboard synced", "success")
  }, [clipText, connected, addToast])

  useEffect(() => { fetchClipboard() }, [fetchClipboard])

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-medium">Remote Clipboard</h3>
        <pre className="bg-muted p-3 rounded text-sm max-h-40 overflow-auto whitespace-pre-wrap break-words">
          {remoteText || "(empty)"}
        </pre>
        <Button size="sm" variant="outline" onClick={fetchClipboard} disabled={!connected}>
          Refresh
        </Button>
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-medium">Push to Remote Clipboard</h3>
        <div className="flex gap-2">
          <Input
            value={clipText}
            onChange={(e) => setClipText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setClipboard() }}
            placeholder="Text to copy to remote..."
            className="flex-1"
          />
          <Button onClick={setClipboard} disabled={!connected}>Send</Button>
        </div>
      </Card>
    </div>
  )
}

// ── Vision ──

function VisionTab() {
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [interval, setInterval] = useState(0)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<number | null>(null)
  const connected = useConnectionStore((s) => s.status === "connected")

  const takeScreenshot = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    try {
      const res = await fetch("/api/vision/screenshot")
      const json = await res.json()
      if (json.success && json.data?.png_b64) {
        setScreenshot(`data:image/png;base64,${json.data.png_b64}`)
      }
    } finally {
      setLoading(false)
    }
  }, [connected])

  useEffect(() => {
    if (interval > 0) {
      takeScreenshot()
      const id = window.setInterval(takeScreenshot, interval * 1000)
      timerRef.current = id
    }
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
    }
  }, [interval, takeScreenshot])

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <Button onClick={takeScreenshot} disabled={!connected || loading}>
            {loading ? "Capturing..." : "Take Screenshot"}
          </Button>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Auto every</label>
            <select
              className="bg-muted border rounded px-2 py-1 text-sm"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              <option value={0}>Off</option>
              <option value={2}>2s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </div>
        </div>
      </Card>
      {screenshot && (
        <Card className="p-2">
          <img src={screenshot} alt="Screenshot" className="w-full rounded" />
        </Card>
      )}
    </div>
  )
}

// ── Browser ──

function BrowserTab() {
  const [url, setUrl] = useState("")
  const addToast = useToastStore((s) => s.addToast)
  const connected = useConnectionStore((s) => s.status === "connected")

  const openUrl = useCallback(async () => {
    if (!url || !connected) return
    const fullUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`
    const res = await fetch("/api/browser/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: fullUrl }),
    })
    const json = await res.json()
    if (json.success) {
      addToast(`Opened ${fullUrl}`, "success")
    }
  }, [url, connected, addToast])

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-medium">Open URL in Remote Browser</h3>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") openUrl() }}
          placeholder="https://example.com"
          className="flex-1"
        />
        <Button onClick={openUrl} disabled={!connected}>Open</Button>
      </div>
    </Card>
  )
}

// ── Windows ──

interface WindowInfo {
  hwnd: number;
  title: string;
}

// ── Lock Screen ──

function LockButton() {
  const connected = useConnectionStore((s) => s.status === "connected")
  const lock = useCallback(async () => {
    await fetch("/api/power/execute", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({action: "lock", confirmed: true}),
    })
  }, [])
  return (
    <Button onClick={lock} disabled={!connected} size="sm" variant="outline" className="ml-auto">
      Lock Screen
    </Button>
  )
}

// ── Disks ──

function DisksTab() {
  const [disks, setDisks] = useState<{mount: string; total_gb: number; used_gb: number; free_gb: number; percent_used: number}[]>([])
  const connected = useConnectionStore((s) => s.status === "connected")

  const fetchDisks = useCallback(async () => {
    if (!connected) return
    const res = await fetch("/api/disks")
    const json = await res.json()
    if (json.success) setDisks(json.disks)
  }, [connected])

  useEffect(() => { fetchDisks() }, [fetchDisks])

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Storage Drives</h3>
        <Button size="sm" variant="outline" onClick={fetchDisks} disabled={!connected}>Refresh</Button>
      </div>
      <div className="space-y-2">
        {disks.map((d, i) => (
          <div key={i} className="p-3 rounded-lg border">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-medium">{d.mount}</span>
              <span className="text-xs text-muted-foreground">{d.used_gb} GB / {d.total_gb} GB</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{width: `${Math.min(d.percent_used, 100)}%`}} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{d.free_gb} GB free — {d.percent_used}% used</p>
          </div>
        ))}
        {disks.length === 0 && <p className="text-sm text-muted-foreground">No disk info available</p>}
      </div>
    </Card>
  )
}

// ── Processes ──

function ProcessesTab() {
  const [processes, setProcesses] = useState<{pid: number; name: string; cpu: number; memory_mb: number}[]>([])
  const connected = useConnectionStore((s) => s.status === "connected")

  const fetchProcs = useCallback(async () => {
    if (!connected) return
    const res = await fetch("/api/processes")
    const json = await res.json()
    if (json.success) setProcesses(json.processes)
  }, [connected])

  useEffect(() => { fetchProcs() }, [fetchProcs])

  const kill = async (pid: number) => {
    const res = await fetch("/api/processes/kill", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({pid}),
    })
    const json = await res.json()
    if (json.success) fetchProcs()
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Top Processes (by CPU)</h3>
        <Button size="sm" variant="outline" onClick={fetchProcs} disabled={!connected}>Refresh</Button>
      </div>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {processes.map((p, i) => (
          <div key={p.pid} className="flex items-center gap-2 p-2 bg-muted rounded text-sm">
            <span className="text-xs text-muted-foreground w-6">{i + 1}</span>
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{p.cpu.toFixed(1)}% CPU</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{p.memory_mb} MB</span>
            <button onClick={() => kill(p.pid)} className="px-2 py-0.5 bg-destructive text-destructive-foreground rounded text-xs">Kill</button>
          </div>
        ))}
        {processes.length === 0 && <p className="text-sm text-muted-foreground">No process data</p>}
      </div>
    </Card>
  )
}

// ── Sessions ──

function SessionsTab() {
  const [sessions, setSessions] = useState<{session_id: number; username: string; state: string}[]>([])
  const connected = useConnectionStore((s) => s.status === "connected")

  const fetchSessions = useCallback(async () => {
    if (!connected) return
    const res = await fetch("/api/sessions")
    const json = await res.json()
    if (json.success) setSessions(json.sessions)
  }, [connected])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  const act = async (session_id: number, action: string) => {
    const res = await fetch("/api/sessions/action", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({session_id, action}),
    })
    const json = await res.json()
    if (json.success) fetchSessions()
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">User Sessions</h3>
        <Button size="sm" variant="outline" onClick={fetchSessions} disabled={!connected}>Refresh</Button>
      </div>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.session_id} className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="text-sm font-medium">{s.username || "(no user)"}</p>
              <p className="text-xs text-muted-foreground">Session {s.session_id} — {s.state}</p>
            </div>
            <div className="flex gap-2">
              {s.state !== "Disconnected" && (
                <Button size="sm" variant="outline" onClick={() => act(s.session_id, "disconnect")}>Disconnect</Button>
              )}
              <Button size="sm" variant="destructive" onClick={() => act(s.session_id, "logoff")}>Logoff</Button>
            </div>
          </div>
        ))}
        {sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions found</p>}
      </div>
    </Card>
  )
}

function WindowsTab() {
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const connected = useConnectionStore((s) => s.status === "connected")

  const refresh = useCallback(async () => {
    if (!connected) return
    const res = await fetch("/api/windows")
    const json = await res.json()
    if (json.success) setWindows(json.windows)
  }, [connected])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [refresh])

  const act = useCallback(async (action: string, hwnd: number) => {
    await fetch(`/api/windows/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hwnd }),
    })
    refresh()
  }, [refresh])

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Open Windows ({windows.length})</h3>
        <Button size="sm" variant="outline" onClick={refresh} disabled={!connected}>Refresh</Button>
      </div>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {windows.map((w) => (
          <div key={w.hwnd} className="flex items-center gap-2 p-2 bg-muted rounded text-sm">
            <span className="flex-1 truncate">{w.title}</span>
            <button onClick={() => act("focus", w.hwnd)} className="px-2 py-0.5 bg-primary text-primary-foreground rounded text-xs">Focus</button>
            <button onClick={() => act("minimize", w.hwnd)} className="px-2 py-0.5 bg-muted-foreground/20 rounded text-xs">Min</button>
            <button onClick={() => act("close", w.hwnd)} className="px-2 py-0.5 bg-destructive text-destructive-foreground rounded text-xs">X</button>
          </div>
        ))}
        {windows.length === 0 && <p className="text-sm text-muted-foreground">No windows found</p>}
      </div>
    </Card>
  )
}

