import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react"
import { Monitor, Cpu, Keyboard, MousePointer, Clipboard, Eye, Globe, HardDrive, KeyRound, Loader2, Lock, Trash } from "lucide-react"
import { useConnectionStore, useToastStore } from "@/lib/store"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

const TerminalTab = lazy(() => import("./TerminalTab"))

type Category = "input" | "monitor" | "system" | "terminal"

export function RemoteDesktopPage() {
  const [activeCategory, setActiveCategory] = useState<Category>("input")

  const categories = [
    { id: "input" as Category, label: "Input Tools", icon: MousePointer },
    { id: "monitor" as Category, label: "Monitor & View", icon: Eye },
    { id: "system" as Category, label: "System Tasks", icon: Cpu },
    { id: "terminal" as Category, label: "Terminal", icon: Monitor },
  ]

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Category Pills (Horizontal Scrollable on mobile, flex row on desktop) */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none snap-x select-none border-b border-border/20">
        {categories.map((c) => {
          const isActive = activeCategory === c.id
          return (
            <button
              key={c.id}
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(10)
                setActiveCategory(c.id)
              }}
              className={cn(
                "flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-2xl text-xs font-semibold uppercase tracking-wider transition-all duration-200 snap-start active:scale-95 touch-target",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 border border-border/30 text-muted-foreground hover:text-foreground"
              )}
            >
              <c.icon className="h-4 w-4" />
              <span>{c.label}</span>
            </button>
          )
        })}
      </div>

      {/* Render selected categories */}
      {activeCategory === "input" && (
        <div className="space-y-6 stagger-children">
          <TrackpadTab />
          <KeyboardTab />
          <ClipboardTab />
        </div>
      )}

      {activeCategory === "monitor" && (
        <div className="space-y-6 stagger-children">
          <VisionTab />
          <BrowserTab />
        </div>
      )}

      {activeCategory === "system" && (
        <div className="space-y-6 stagger-children">
          <div className="flex justify-between items-center px-1">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Active Workspace</h3>
            <LockButton />
          </div>
          <DisksTab />
          <WindowsTab />
          <ProcessesTab />
          <SessionsTab />
        </div>
      )}

      {activeCategory === "terminal" && (
        <div className="animate-fade-in">
          <Suspense fallback={
            <Card variant="glass" className="h-[calc(100vh-14rem)] flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">Connecting terminal console...</span>
            </Card>
          }>
            <TerminalTab />
          </Suspense>
        </div>
      )}
    </div>
  )
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ")
}

// ── Lock Screen ──
function LockButton() {
  const connected = useConnectionStore((s) => s.status === "connected")
  const lock = useCallback(async () => {
    if (navigator.vibrate) navigator.vibrate(15)
    await fetch("/api/power/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lock", confirmed: true }),
    })
  }, [])
  
  return (
    <Button onClick={lock} disabled={!connected} size="sm" variant="destructive" className="rounded-xl shadow-sm">
      <Lock className="h-3.5 w-3.5 mr-1.5" />
      Lock Desktop
    </Button>
  )
}

// ── Trackpad ──
function TrackpadTab() {
  const padRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const prevTouch = useRef<{ x: number; y: number } | null>(null)
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
    
    // Track touch start point
    if ("touches" in e && e.touches.length > 0) {
      const touch = e.touches[0]
      prevTouch.current = { x: touch.clientX, y: touch.clientY }
    }
    
    // Trigger tap click
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
    } else if ("touches" in e && e.touches.length > 0) {
      const touch = e.touches[0]
      if (prevTouch.current) {
        // Natural delta touch tracking (eliminates cursor jumps)
        dx = (touch.clientX - prevTouch.current.x) * 2.5
        dy = (touch.clientY - prevTouch.current.y) * 2.5
      }
      prevTouch.current = { x: touch.clientX, y: touch.clientY }
    }
    
    if (dx !== 0 || dy !== 0) {
      api("/api/input/mouse/move", { x: dx, y: dy, relative: true }).catch(() => {})
    }
  }, [api])

  const handleUp = useCallback(() => {
    dragging.current = false
    prevTouch.current = null
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!connected) return
    api("/api/input/mouse/scroll", { dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) })
  }, [api, connected])

  const clickButton = useCallback((btn: string, double = false) => {
    if (!connected) return
    if (navigator.vibrate) navigator.vibrate(10)
    api("/api/input/mouse/click", { button: btn, double })
  }, [api, connected])

  return (
    <div className="space-y-3">
      <Card variant="glass" className="p-4 overflow-hidden">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <MousePointer className="h-4 w-4 text-primary" /> Trackpad
        </h3>
        <div
          ref={padRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="button"
          tabIndex={0}
          aria-label="Trackpad interaction pad"
          className="w-full h-56 md:h-64 rounded-xl cursor-crosshair select-none border border-dashed border-border/50 bg-muted/20 flex flex-col items-center justify-center text-muted-foreground text-xs leading-relaxed p-4 text-center font-medium"
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
          {!connected ? (
            <span className="text-destructive font-semibold">Disconnected</span>
          ) : (
            <div className="space-y-1">
              <p className="font-semibold text-foreground/80">Drag to control cursor</p>
              <p className="text-[10px] text-muted-foreground/60">Tap to click • Two-finger drag to scroll</p>
            </div>
          )}
        </div>
      </Card>
      <div className="flex gap-2 flex-wrap px-1 select-none">
        <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => clickButton("left")}>Left click</Button>
        <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => clickButton("right")}>Right click</Button>
        <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => clickButton("middle")}>Middle click</Button>
        <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => clickButton("left", true)}>Double click</Button>
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
    if (navigator.vibrate) navigator.vibrate(10)
    await fetch("/api/input/keyboard/type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    setText("")
  }, [text, connected])

  const sendHotkey = useCallback(async (keys: string[]) => {
    if (!connected) return
    if (navigator.vibrate) navigator.vibrate(10)
    await fetch("/api/input/keyboard/press", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    })
  }, [connected])

  const sendMedia = useCallback(async (key: string) => {
    if (!connected) return
    if (navigator.vibrate) navigator.vibrate(10)
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
      <Card variant="glass" className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <Keyboard className="h-4 w-4 text-primary" /> Remote Keyboard
        </h3>
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendType() }}
            placeholder="Type text to send remotely..."
            className="flex-1 h-11 text-base md:text-sm md:h-10 rounded-xl"
          />
          <Button onClick={sendType} size="touch" className="h-11 md:h-10 rounded-xl font-semibold" disabled={!connected}>Send</Button>
        </div>
      </Card>
      
      <Card variant="glass" className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Macro Hotkeys</h3>
        <div className="flex gap-2 flex-wrap">
          {hotkeys.map((h) => (
            <Button key={h.label} size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => sendHotkey(h.keys)} disabled={!connected}>
              {h.label}
            </Button>
          ))}
        </div>
      </Card>
      
      <Card variant="glass" className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Media Macro Keys</h3>
        <div className="flex gap-2 flex-wrap">
          {["play_pause", "next", "prev", "volume_up", "volume_down", "mute"].map((k) => (
            <Button key={k} size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => sendMedia(k)} disabled={!connected}>
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
    if (navigator.vibrate) navigator.vibrate(10)
    await fetch("/api/clipboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clipText }),
    })
    setClipText("")
    addToast("Clipboard synced", "success")
    fetchClipboard()
  }, [clipText, connected, addToast, fetchClipboard])

  useEffect(() => { fetchClipboard() }, [fetchClipboard])

  return (
    <div className="space-y-4">
      <Card variant="glass" className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center justify-between">
          <span className="flex items-center gap-1.5"><Clipboard className="h-4 w-4 text-primary" /> Remote Clipboard</span>
          <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={fetchClipboard} disabled={!connected}>
            Sync
          </Button>
        </h3>
        <pre className="bg-muted/40 p-4 rounded-xl text-xs font-mono max-h-36 overflow-auto border border-border/20 whitespace-pre-wrap break-all shadow-inner">
          {remoteText || "(empty)"}
        </pre>
      </Card>
      
      <Card variant="glass" className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Push Text to PC</h3>
        <div className="flex gap-2">
          <Input
            value={clipText}
            onChange={(e) => setClipText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setClipboard() }}
            placeholder="Text to copy to remote clipboard..."
            className="flex-grow h-11 text-base md:text-sm md:h-10 rounded-xl"
          />
          <Button onClick={setClipboard} size="touch" className="h-11 md:h-10 rounded-xl font-semibold" disabled={!connected}>Push</Button>
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
      <Card variant="glass" className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center justify-between">
          <span className="flex items-center gap-1.5"><Eye className="h-4 w-4 text-primary" /> Vision Stream</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Interval:</span>
            <select
              className="bg-background border border-border/50 rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer outline-none"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              <option value={0}>Manual Only</option>
              <option value={2}>2s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </div>
        </h3>
        
        <div className="flex gap-2">
          <Button onClick={takeScreenshot} size="touch" className="w-full font-semibold shadow-sm" disabled={!connected || loading}>
            {loading ? "Capturing..." : "Trigger Screen Grab"}
          </Button>
        </div>
      </Card>
      
      {screenshot && (
        <Card variant="glass" className="p-2 overflow-hidden shadow-md">
          <img src={screenshot} alt="Remote Desktop Viewport" className="w-full rounded-xl object-contain border border-border/30" />
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
    if (navigator.vibrate) navigator.vibrate(10)
    const fullUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`
    const res = await fetch("/api/browser/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: fullUrl }),
    })
    const json = await res.json()
    if (json.success) {
      addToast(`Opened ${fullUrl}`, "success")
      setUrl("")
    }
  }, [url, connected, addToast])

  return (
    <Card variant="glass" className="p-4 space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
        <Globe className="h-4 w-4 text-primary" /> Remote Browser launcher
      </h3>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") openUrl() }}
          placeholder="Enter website link, e.g., google.com"
          className="flex-grow h-11 text-base md:text-sm md:h-10 rounded-xl"
        />
        <Button onClick={openUrl} size="touch" className="h-11 md:h-10 rounded-xl font-semibold" disabled={!connected}>Open</Button>
      </div>
    </Card>
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
    <Card variant="glass" className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <HardDrive className="h-4 w-4 text-primary" /> Storage Volumes
        </h3>
        <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={fetchDisks} disabled={!connected}>
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {disks.map((d, i) => (
          <div key={i} className="p-4 rounded-2xl border border-border/40 bg-muted/10 space-y-2">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-bold text-foreground/80">{d.mount} Drive</span>
              <span className="text-xs text-muted-foreground font-mono">{d.used_gb} GB / {d.total_gb} GB</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden shadow-inner">
              <div className="h-full bg-primary rounded-full" style={{width: `${Math.min(d.percent_used, 100)}%`}} />
            </div>
            <p className="text-[10px] text-muted-foreground/80 mt-1">{d.free_gb} GB free — {d.percent_used}% occupied</p>
          </div>
        ))}
        {disks.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-medium text-muted-foreground">No disk info available</p>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Processes ──
function ProcessesTab() {
  const [processes, setProcesses] = useState<{pid: number; name: string; cpu: number; memory_mb: number}[]>([])
  const [confirmPid, setConfirmPid] = useState<{pid: number; name: string} | null>(null)
  const connected = useConnectionStore((s) => s.status === "connected")

  const fetchProcs = useCallback(async () => {
    if (!connected) return
    const res = await fetch("/api/processes")
    const json = await res.json()
    if (json.success) setProcesses(json.processes)
  }, [connected])

  useEffect(() => { fetchProcs() }, [fetchProcs])

  const kill = async (pid: number) => {
    if (navigator.vibrate) navigator.vibrate(15)
    const res = await fetch("/api/processes/kill", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({pid}),
    })
    const json = await res.json()
    if (json.success) fetchProcs()
  }

  return (
    <Card variant="glass" className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <Cpu className="h-4 w-4 text-primary" /> Active Tasks (CPU)
        </h3>
        <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={fetchProcs} disabled={!connected}>
          Refresh
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1.5 scrollbar-thin">
        {processes.map((p, i) => (
          <div key={p.pid} className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-border/10 bg-muted/10 text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-grow">
              <span className="text-[10px] text-muted-foreground font-mono w-5 shrink-0 text-center">{i + 1}</span>
              <span className="font-semibold text-foreground truncate">{p.name}</span>
            </div>
            
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono font-medium text-[10px] text-muted-foreground">{p.cpu.toFixed(1)}%</span>
              <span className="font-mono font-medium text-[10px] text-muted-foreground">{p.memory_mb} MB</span>
              
              <Button
                type="button"
                variant="destructive"
                className="h-8 px-3.5 text-xs rounded-xl"
                onClick={() => setConfirmPid({ pid: p.pid, name: p.name })}
              >
                <Trash className="h-3.5 w-3.5 mr-1" /> Kill
              </Button>
            </div>
          </div>
        ))}
        {processes.length === 0 && (
          <p className="text-center py-8 text-xs text-muted-foreground/60">No process info available</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmPid != null}
        onOpenChange={() => setConfirmPid(null)}
        title="Terminate Process"
        description={`Are you sure you want to terminate "${confirmPid?.name}" (PID: ${confirmPid?.pid})? Unsaved work will be lost.`}
        confirmText="KILL"
        actionLabel="Kill Task"
        onConfirm={() => {
          if (confirmPid) kill(confirmPid.pid)
          setConfirmPid(null)
        }}
      />
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
    if (navigator.vibrate) navigator.vibrate(15)
    const res = await fetch("/api/sessions/action", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({session_id, action}),
    })
    const json = await res.json()
    if (json.success) fetchSessions()
  }

  return (
    <Card variant="glass" className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <KeyRound className="h-4 w-4 text-primary" /> active RDP/OS Sessions
        </h3>
        <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={fetchSessions} disabled={!connected}>
          Refresh
        </Button>
      </div>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.session_id} className="flex items-center justify-between p-3.5 rounded-2xl border border-border/40 bg-muted/10">
            <div>
              <p className="text-sm font-semibold text-foreground/80">{s.username || "(no user)"}</p>
              <p className="text-[10px] text-muted-foreground/80 mt-0.5">Session ID: {s.session_id} — {s.state}</p>
            </div>
            <div className="flex gap-2">
              {s.state !== "Disconnected" && (
                <Button size="sm" variant="outline" className="h-8 text-xs rounded-xl" onClick={() => act(s.session_id, "disconnect")}>Disconnect</Button>
              )}
              <Button size="sm" variant="destructive" className="h-8 text-xs rounded-xl" onClick={() => act(s.session_id, "logoff")}>Logoff</Button>
            </div>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-center py-8 text-xs text-muted-foreground/60">No sessions info available</p>
        )}
      </div>
    </Card>
  )
}

interface WindowInfo {
  hwnd: number;
  title: string;
}

// ── Windows ──
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
    if (navigator.vibrate) navigator.vibrate(10)
    await fetch(`/api/windows/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hwnd }),
    })
    refresh()
  }, [refresh])

  return (
    <Card variant="glass" className="p-4 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <Monitor className="h-4 w-4 text-primary" /> Window Manager
        </h3>
        <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={refresh} disabled={!connected}>
          Refresh
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto space-y-2 pr-1.5 scrollbar-thin">
        {windows.map((w) => (
          <div key={w.hwnd} className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-border/10 bg-muted/10 text-xs">
            <span className="font-semibold text-foreground truncate flex-grow mr-2">{w.title}</span>
            <div className="flex items-center gap-1.5 shrink-0 select-none">
              <Button size="sm" variant="outline" className="h-8 text-xs rounded-xl" onClick={() => act("focus", w.hwnd)}>Focus</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs rounded-xl" onClick={() => act("minimize", w.hwnd)}>Min</Button>
              <Button size="sm" variant="destructive" className="h-8 text-xs rounded-xl" onClick={() => act("close", w.hwnd)}>Close</Button>
            </div>
          </div>
        ))}
        {windows.length === 0 && (
          <p className="text-center py-8 text-xs text-muted-foreground/60">No open windows detected</p>
        )}
      </div>
    </Card>
  )
}
