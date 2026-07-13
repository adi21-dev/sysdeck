import { useState, useRef, useCallback, useEffect } from "react"
import { Play, Copy, Check, AlertTriangle, Pin, PinOff, Trash2, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"

import { cn } from "@/lib/utils"
import { useScriptsStore, type ScriptOutput } from "@/lib/scripts-store"
import { useToastStore } from "@/lib/store"
import { InfoButton } from "@/components/ui/info-button"

interface SavedScript {
  id: string
  title: string
  content: string
  script_type: string
  pinned: boolean
  pinned_order: number | null
  created_at: number
  updated_at: number
}

const PREDEFINED = [
  { label: "Custom", type: "", content: "" },
  { label: "System Info", type: "powershell", content: "Get-ComputerInfo | Format-List | Out-String -Width 4096" },
  { label: "IP Config", type: "cmd", content: "ipconfig /all" },
  { label: "Ping Test", type: "cmd", content: "ping 8.8.8.8 -n 10" },
]

const WINGET = [
  { label: "List Installed", content: "winget list" },
  { label: "Update All", content: "winget upgrade --all" },
  { label: "List Upgrades", content: "winget upgrade" },
  { label: "Export JSON", content: "winget export -o packages.json" },
]

export function ScriptsPage() {
  const {
    mode, scriptType, content, predefined, running,
    output, status,
    setMode, setScriptType, setContent, setPredefined,
    setRunning, setRunId, addOutput, clearOutput,
    setStatus,
  } = useScriptsStore()

  const addToast = useToastStore((s) => s.addToast)

  const [localError, setLocalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [timeoutMinutes, setTimeoutMinutes] = useState(5)
  const outputRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveTitle, setSaveTitle] = useState("")

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SavedScript | null>(null)

  const pinnedTiles = savedScripts
    .filter((s) => s.pinned)
    .sort((a, b) => (a.pinned_order ?? 99) - (b.pinned_order ?? 99))

  const fetchSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/scripts/saved")
      const data = await res.json()
      if (data.success) setSavedScripts(data.scripts)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchSaved() }, [fetchSaved])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const scrollToBottom = () => {
    setTimeout(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight
      }
    }, 50)
  }

  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onmessage = null
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const loadSavedScript = (s: SavedScript) => {
    setPredefined("Custom")
    setScriptType(s.script_type as "powershell" | "cmd")
    setContent(s.content)
    setActiveSavedId(s.id)
    setDropdownOpen(false)
  }

  const handleRun = async () => {
    setLocalError(null)
    clearOutput()
    disconnectWs()

    const scriptContent = predefined === "Custom" ? content : PREDEFINED.find((p) => p.label === predefined)?.content
    if (!scriptContent?.trim()) {
      setLocalError("No script content")
      return
    }

    setRunning(true)
    setStatus("running")

    try {
      const res = await fetch("/api/scripts/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script_type: scriptType,
          content: scriptContent,
          mode,
          timeout_seconds: timeoutMinutes > 0 ? timeoutMinutes * 60 : 0,
        }),
      })
      const data = await res.json()

      if (!data.success) {
        setStatus("failed")
        addOutput({ stream: "system", data: data.message || "Execution failed" })
        setRunning(false)
        return
      }

      setRunId(data.id)

      if (mode === "wait" && data.result) {
        const r = data.result
        if (r.stdout) addOutput({ stream: "stdout", data: r.stdout.trimEnd() })
        if (r.stderr) addOutput({ stream: "stderr", data: r.stderr.trimEnd() })
        addOutput({ stream: "system", data: `Process exited with code ${r.exit_code}` })
        if (r.truncated) addOutput({ stream: "system", data: "[Output truncated at 1MB]" })
        setStatus("completed")
        setRunning(false)
        scrollToBottom()
      } else if (mode === "live" && data.id) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws/script/${data.id}`)

        ws.onmessage = (event) => {
          try {
            const msg: ScriptOutput & { event?: string } = JSON.parse(event.data)
            if (msg.event === "done") {
              addOutput({ stream: "system", data: "Process completed" })
              setStatus("completed")
              setRunning(false)
              ws.close()
              return
            }
            addOutput(msg)
            scrollToBottom()
          } catch { /* ignore */ }
        }
        ws.onerror = () => {
          addOutput({ stream: "system", data: "WebSocket connection error" })
          setStatus("failed")
          setRunning(false)
        }
        ws.onclose = () => {
          if (useScriptsStore.getState().status === "running") {
            addOutput({ stream: "system", data: "Connection lost" })
            setStatus("failed")
            setRunning(false)
          }
        }
        wsRef.current = ws
      }
    } catch {
      setLocalError("Network error")
      setStatus("failed")
      setRunning(false)
    }
  }

  useEffect(() => {
    return () => { disconnectWs() }
  }, [disconnectWs])

  const handleCopyAll = async () => {
    const text = output.map((o) => `[${o.stream}] ${o.data}`).join("\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = async () => {
    if (!saveTitle.trim()) return
    const body = {
      title: saveTitle.trim(),
      content: predefined === "Custom" ? content : PREDEFINED.find((p) => p.label === predefined)?.content || content,
      script_type: scriptType,
    }
    if (activeSavedId) {
      const res = await fetch(`/api/scripts/saved/${activeSavedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        addToast("Script updated", "success")
        await fetchSaved()
      } else {
        addToast(data.message || "Failed to update", "error")
      }
    } else {
      const res = await fetch("/api/scripts/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        addToast("Script saved", "success")
        setActiveSavedId(data.script.id)
        await fetchSaved()
      } else {
        addToast(data.message || "Failed to save", "error")
      }
    }
    setSaveDialogOpen(false)
    setSaveTitle("")
  }

  const handlePinToggle = async (s: SavedScript) => {
    const res = await fetch(`/api/scripts/saved/${s.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !s.pinned }),
    })
    const data = await res.json()
    if (data.success) {
      addToast(s.pinned ? "Unpinned" : "Pinned", "success")
      await fetchSaved()
    } else {
      addToast(data.message || "Failed to pin", "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const res = await fetch(`/api/scripts/saved/${deleteTarget.id}`, { method: "DELETE" })
    const data = await res.json()
    if (data.success) {
      addToast("Script deleted", "success")
      if (activeSavedId === deleteTarget.id) {
        setActiveSavedId(null)
      }
      await fetchSaved()
    } else {
      addToast(data.message || "Failed to delete", "error")
    }
    setDeleteDialogOpen(false)
    setDeleteTarget(null)
  }

  const selectedLabel = activeSavedId
    ? savedScripts.find((s) => s.id === activeSavedId)?.title || "Custom"
    : predefined

  const statusBadge = () => {
    switch (status) {
      case "running": return <Badge variant="default" className="bg-chart-2">Running</Badge>
      case "completed": return <Badge variant="secondary">Completed</Badge>
      case "failed": return <Badge variant="destructive">Failed</Badge>
      case "timed_out": return <Badge variant="destructive">Timed Out</Badge>
      default: return null
    }
  }

  return (
    <div className="space-y-4">
      {pinnedTiles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pinnedTiles.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSavedScript(s)}
              className={cn(
                "flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-xl border text-sm transition-all",
                activeSavedId === s.id
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/30 bg-muted/30 hover:bg-muted/50",
              )}
            >
              <span className="max-w-28 truncate">{s.title}</span>
              <X
                className="h-3 w-3 text-muted-foreground hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); handlePinToggle(s) }}
              />
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-4">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />

            <div className="flex flex-col sm:flex-row gap-3">
              {/* ponytail: inline dropdown, extract to shared component if another page needs one */}
              <div className="relative flex-1" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
                >
                  <span>{selectedLabel}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
                {dropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-xl border border-border/50 bg-popover backdrop-blur-xl saturate-[1.4] shadow-xl overflow-hidden">
                    <div className="py-1 max-h-72 overflow-y-auto">
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Predefined</div>
                      {PREDEFINED.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => {
                            setPredefined(p.label)
                            setActiveSavedId(null)
                            if (p.type) { setScriptType(p.type as "powershell" | "cmd"); setContent(p.content) }
                            else { setScriptType("cmd"); setContent("") }
                            setDropdownOpen(false)
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                        >
                          {p.label}
                        </button>
                      ))}
                      <div className="border-t border-border/30 my-1" />
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">WinGet</div>
                      {WINGET.map((w) => (
                        <button
                          key={w.label}
                          onClick={() => {
                            setPredefined("Custom")
                            setActiveSavedId(null)
                            setScriptType("cmd")
                            setContent(w.content)
                            setDropdownOpen(false)
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                        >
                          {w.label}
                        </button>
                      ))}
                      {savedScripts.length > 0 && (
                        <>
                          <div className="border-t border-border/30 my-1" />
                          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">Saved</div>
                          {savedScripts.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center gap-1 px-1 hover:bg-muted/50 transition-colors group"
                            >
                              <button
                                onClick={() => loadSavedScript(s)}
                                className="flex-1 text-left px-2 py-1.5 text-sm truncate"
                              >
                                {s.title}
                              </button>
                              <button
                                onClick={() => handlePinToggle(s)}
                                className="shrink-0 p-1 rounded hover:bg-muted-foreground/10"
                                title={s.pinned ? "Unpin" : "Pin"}
                              >
                                {s.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5 text-muted-foreground" />}
                              </button>
                              <button
                                onClick={() => { setDeleteTarget(s); setDeleteDialogOpen(true) }}
                                className="shrink-0 p-1 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <select
                value={scriptType}
                onChange={(e) => setScriptType(e.target.value as "powershell" | "cmd")}
                className="px-3 py-1.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
              >
                <option value="powershell">PowerShell</option>
                <option value="cmd">CMD</option>
              </select>
              <InfoButton content={"Run PowerShell or CMD scripts remotely.\nSave frequently-used scripts as templates and load them from the Saved dropdown.\nTimeout is configurable below (default 5 min, set 0 for no limit).\n\nExample: save a \"System Info\" script once, then load and run it on any machine without retyping."} className="ml-1.5 align-middle" />
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="mode" checked={mode === "live"} onChange={() => setMode("live")} className="text-primary accent-primary" />
                Live Output<InfoButton content={"Streams output live as the script runs.\nUse for long tasks like installing software where you want to see progress."} className="ml-1 align-middle" />
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="mode" checked={mode === "wait"} onChange={() => setMode("wait")} className="text-primary accent-primary" />
                Wait & Show<InfoButton content={"Runs silently, returns all output at once.\nUse for quick commands where you only need the final result (e.g. `ipconfig /all`)."} className="ml-1 align-middle" />
              </label>
            </div>

            {/* Timeout */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Timeout:</span>
              {[0, 1, 5, 15, 30].map((m) => (
                <button
                  key={m}
                  onClick={() => setTimeoutMinutes(m)}
                  className={cn(
                    "px-2 py-0.5 rounded-md border text-xs font-medium transition-colors",
                    timeoutMinutes === m
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/30 hover:bg-muted/40"
                  )}
                >
                  {m === 0 ? "∞" : `${m}m`}
                </button>
              ))}
              <InfoButton content="Timeout in minutes. Set to ∞ (0) for no limit.\n\nExample: set 15m for a long database migration script that might take longer than the default 5m." />
            </div>

            {(predefined === "Custom" || !PREDEFINED.find((p) => p.label === predefined)?.type) && (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter your script here..."
                rows={8}
                className="w-full px-3 py-2 rounded-xl border border-input bg-background/50 backdrop-blur-sm font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none transition-all"
              />
            )}

            <div className="flex gap-2">
              <Button onClick={handleRun} disabled={running} className="flex-1">
                <Play className="h-4 w-4 mr-2" />
                {running ? "Running..." : "Run Script"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const currentContent = predefined === "Custom" ? content : PREDEFINED.find((p) => p.label === predefined)?.content || content
                  if (!currentContent.trim()) { addToast("Nothing to save", "error"); return }
                  setSaveTitle(activeSavedId ? savedScripts.find((s) => s.id === activeSavedId)?.title || "" : "")
                  setSaveDialogOpen(true)
                }}
              >
                {activeSavedId ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold relative">Output</h3>
              {statusBadge()}
            </div>
            <button
              onClick={handleCopyAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy All"}
            </button>
          </div>
          <div
            ref={outputRef}
            className="bg-muted/30 backdrop-blur-sm rounded-xl p-4 font-mono text-xs h-80 overflow-y-auto space-y-1 border border-border/20"
          >
            {output.length === 0 && (
              <p className="text-muted-foreground italic">Waiting for output...</p>
            )}
            {output.map((line, i) => (
              <div key={i} className={cn(
                "whitespace-pre-wrap break-all",
                line.stream === "stderr" && "text-destructive",
                line.stream === "system" && "text-muted-foreground",
              )}>
                {line.stream === "system" ? (
                  <><span className="text-muted-foreground">▸</span> {line.data}</>
                ) : line.stream === "stderr" ? (
                  <><span className="text-xs text-destructive">[stderr]</span> {line.data}</>
                ) : (
                  line.data
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {localError && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 backdrop-blur-sm saturate-[1.4] p-3 text-sm text-destructive border border-destructive/10">
          <AlertTriangle className="h-4 w-4" />
          <span>{localError}</span>
        </div>
      )}

      <AlertDialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{activeSavedId ? "Update Script" : "Save Script"}</AlertDialogTitle>
            <AlertDialogDescription>Give your script a name to save it.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={saveTitle}
            onChange={(e) => setSaveTitle(e.target.value)}
            placeholder="Script name"
            onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={handleSave} disabled={!saveTitle.trim()}>
              {activeSavedId ? "Update" : "Save"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.title}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
