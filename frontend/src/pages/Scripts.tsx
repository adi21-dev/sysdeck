import { useState, useRef, useCallback, useEffect, useId } from "react"
import { Play, Copy, Check, AlertTriangle, Pin, PinOff, Trash2, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
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
  const dropdownButtonId = useId()
  const dropdownListBoxId = useId()

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

  // Keyboard accessibility inside custom dropdown
  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setDropdownOpen(false)
  }

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

    if (navigator.vibrate) navigator.vibrate(10)
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
      case "running": return <Badge variant="default" className="bg-primary/20 text-primary border-primary/20">Running</Badge>
      case "completed": return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/10">Completed</Badge>
      case "failed": return <Badge variant="destructive" className="bg-destructive/15 text-destructive border-destructive/10">Failed</Badge>
      case "timed_out": return <Badge variant="destructive" className="bg-destructive/15 text-destructive border-destructive/10">Timed Out</Badge>
      default: return null
    }
  }

  return (
    <div className="space-y-4">
      {/* Pinned horizontal tiles */}
      {pinnedTiles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none snap-x select-none">
          {pinnedTiles.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-1 shrink-0 rounded-2xl border text-xs font-semibold pl-3 pr-1 py-1.5 snap-start shadow-sm transition-all duration-200",
                activeSavedId === s.id
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-border/40 bg-card hover:bg-accent/60"
              )}
            >
              <button
                type="button"
                onClick={() => loadSavedScript(s)}
                className="max-w-28 truncate font-medium text-left mr-1"
              >
                {s.title}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handlePinToggle(s) }}
                className="touch-target h-7 w-7 rounded-lg hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0"
                aria-label={`Unpin ${s.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
        <div className="space-y-4">
          <Card variant="glass" className="p-5 space-y-4 shadow-sm border border-border/40">
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Accessible Custom Dropdown */}
              {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div className="relative flex-grow" ref={dropdownRef} onKeyDown={handleDropdownKeyDown}>
                <button
                  id={dropdownButtonId}
                  aria-haspopup="listbox"
                  aria-expanded={dropdownOpen}
                  aria-controls={dropdownListBoxId}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full flex items-center justify-between h-10 px-3.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-all"
                >
                  <span className="font-semibold">{selectedLabel}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
                
                {dropdownOpen && (
                  <div 
                    id={dropdownListBoxId}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                    role="listbox"
                    aria-labelledby={dropdownButtonId}
                    className="absolute z-50 mt-1.5 w-full rounded-2xl border border-border/40 bg-popover backdrop-blur-xl saturate-[1.5] shadow-xl overflow-hidden animate-fade-in"
                  >
                    <div className="py-1.5 max-h-72 overflow-y-auto">
                      <div className="px-3.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none my-1.5">Predefined</div>
                      {PREDEFINED.map((p) => (
                        <button
                          key={p.label}
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                          role="option"
                          aria-selected={predefined === p.label && !activeSavedId}
                          onClick={() => {
                            setPredefined(p.label)
                            setActiveSavedId(null)
                            if (p.type) { setScriptType(p.type as "powershell" | "cmd"); setContent(p.content) }
                            else { setScriptType("cmd"); setContent("") }
                            setDropdownOpen(false)
                          }}
                          className="w-full text-left px-3.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors font-medium"
                        >
                          {p.label}
                        </button>
                      ))}
                      
                      <div className="border-t border-border/30 my-1.5" />
                      <div className="px-3.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none my-1.5">WinGet</div>
                      {WINGET.map((w) => (
                        <button
                          key={w.label}
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            setPredefined("Custom")
                            setActiveSavedId(null)
                            setScriptType("cmd")
                            setContent(w.content)
                            setDropdownOpen(false)
                          }}
                          className="w-full text-left px-3.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors font-medium"
                        >
                          {w.label}
                        </button>
                      ))}
                      
                      {savedScripts.length > 0 && (
                        <>
                          <div className="border-t border-border/30 my-1.5" />
                          <div className="px-3.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none my-1.5">Saved</div>
                          {savedScripts.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center gap-1 px-1 hover:bg-accent hover:text-accent-foreground transition-colors group"
                            >
                              <button
                                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                                role="option"
                                aria-selected={activeSavedId === s.id}
                                onClick={() => loadSavedScript(s)}
                                className="flex-grow text-left px-2.5 py-2 text-sm truncate font-medium"
                              >
                                {s.title}
                              </button>
                              
                              {/* Pins (Touch target optimization) */}
                              <button
                                type="button"
                                onClick={() => handlePinToggle(s)}
                                className="touch-target h-9 w-9 rounded-xl hover:bg-muted-foreground/15 flex items-center justify-center shrink-0"
                                title={s.pinned ? "Unpin" : "Pin"}
                              >
                                {s.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5 text-muted-foreground" />}
                              </button>
                              
                              {/* Delete script button always visible on mobile */}
                              <button
                                type="button"
                                onClick={() => { setDeleteTarget(s); setDeleteDialogOpen(true) }}
                                className="touch-target h-9 w-9 rounded-xl hover:bg-destructive/10 flex items-center justify-center shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
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

              {/* Script Type selector */}
              <div className="relative">
                <select
                  value={scriptType}
                  onChange={(e) => setScriptType(e.target.value as "powershell" | "cmd")}
                  className="h-10 px-3.5 py-1.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-all select-none appearance-none pr-8 font-semibold"
                >
                  <option value="powershell">PowerShell</option>
                  <option value="cmd">CMD</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              
              <div className="inline-flex items-center shrink-0">
                <InfoButton content={"Run PowerShell or CMD scripts remotely.\nSave frequently-used scripts as templates and load them from the Saved dropdown.\nTimeout is configurable below (default 5 min, set 0 for no limit)."} />
              </div>
            </div>

            {/* Run mode options */}
            <div className="flex items-center gap-4 bg-muted/40 p-3.5 rounded-xl border border-border/30">
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground/80 cursor-pointer select-none">
                <input type="radio" name="mode" checked={mode === "live"} onChange={() => setMode("live")} className="h-4.5 w-4.5 text-primary accent-primary" />
                <span>Live Output</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground/80 cursor-pointer select-none">
                <input type="radio" name="mode" checked={mode === "wait"} onChange={() => setMode("wait")} className="h-4.5 w-4.5 text-primary accent-primary" />
                <span>Wait & Show</span>
              </label>
            </div>

            {/* Timeout */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span className="font-semibold text-muted-foreground/80 mr-1 uppercase tracking-wider text-[10px]">Timeout limit:</span>
              {[0, 1, 5, 15, 30].map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setTimeoutMinutes(m)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all duration-200 active:scale-95",
                    timeoutMinutes === m
                      ? "border-primary/30 bg-primary/10 text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.05)]"
                      : "border-border/40 hover:bg-accent"
                  )}
                >
                  {m === 0 ? "No limit" : `${m}m`}
                </button>
              ))}
            </div>

            {/* Textarea */}
            {(predefined === "Custom" || !PREDEFINED.find((p) => p.label === predefined)?.type) && (
              <div className="relative rounded-xl overflow-hidden border border-border/50 bg-background/50">
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter your command script here..."
                  rows={8}
                  className="w-full p-4 font-mono text-[13px] leading-relaxed focus:outline-none focus:ring-0 resize-none transition-all"
                />
              </div>
            )}

            {/* Execute buttons */}
            <div className="flex gap-3">
              <Button onClick={handleRun} disabled={running} size="touch" className="flex-1 font-bold shadow-md">
                <Play className="h-4 w-4 mr-2" />
                {running ? "Executing..." : "Run Script"}
              </Button>
              <Button
                variant="outline"
                size="touch"
                className="px-6 font-semibold"
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
          </Card>
        </div>

        {/* Output Panel */}
        <Card variant="glass" className="p-5 flex flex-col h-full shadow-sm border border-border/40">
          <div className="flex items-center justify-between mb-3.5 relative z-10">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Console Output</h3>
              {statusBadge()}
            </div>
            
            <button
              type="button"
              onClick={handleCopyAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 touch-target p-1 rounded-lg"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="font-semibold">{copied ? "Copied" : "Copy All"}</span>
            </button>
          </div>
          
          <div
            ref={outputRef}
            className="bg-muted/40 font-mono text-[11px] leading-relaxed h-[340px] overflow-y-auto space-y-1.5 p-4 rounded-xl border border-border/20 shadow-inner relative z-10"
          >
            {output.length === 0 && (
              <p className="text-muted-foreground/60 italic">Console idle. Execute a script to inspect stdout...</p>
            )}
            {output.map((line, i) => (
              <div key={i} className={cn(
                "whitespace-pre-wrap break-all",
                line.stream === "stderr" && "text-destructive font-medium",
                line.stream === "system" && "text-muted-foreground font-semibold",
              )}>
                {line.stream === "system" ? (
                  <><span className="text-muted-foreground">▸</span> {line.data}</>
                ) : line.stream === "stderr" ? (
                  <><span className="text-destructive font-semibold">[stderr]</span> {line.data}</>
                ) : (
                  line.data
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {localError && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 backdrop-blur-sm p-3.5 text-xs text-destructive border border-destructive/10 animate-fade-in max-w-md">
          <AlertTriangle className="h-4.5 w-4.5 shrink-0" />
          <span className="font-semibold">{localError}</span>
        </div>
      )}

      <AlertDialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{activeSavedId ? "Update Script Template" : "Save Custom Script"}</AlertDialogTitle>
            <AlertDialogDescription>Specify a unique name for this script template.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="Script title"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
              className="h-11"
            />
          </div>
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
              Are you sure you want to permanently delete "{deleteTarget?.title}"? This cannot be undone.
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
