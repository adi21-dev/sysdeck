import { useState, useRef, useCallback, useEffect } from "react"
import { Play, Copy, Check, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useScriptsStore, type ScriptOutput } from "@/lib/scripts-store"

const PREDEFINED = [
  { label: "Custom", type: "", content: "" },
  { label: "System Info", type: "powershell", content: "Get-ComputerInfo | Format-List | Out-String -Width 4096" },
  { label: "IP Config", type: "cmd", content: "ipconfig /all" },
  { label: "Ping Test", type: "cmd", content: "ping 8.8.8.8 -n 10" },
]

export function ScriptsPage() {
  const {
    mode, scriptType, content, predefined, running,
    output, status, consoleOpen, errorCount,
    setMode, setScriptType, setContent, setPredefined,
    setRunning, setRunId, addOutput, clearOutput,
    setStatus, setConsoleOpen,
  } = useScriptsStore()

  const [localError, setLocalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const scrollToBottom = () => {
    setTimeout(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight
      }
    }, 50)
  }

  const handlePredefinedChange = (label: string) => {
    setPredefined(label)
    const script = PREDEFINED.find((p) => p.label === label)
    if (script && script.type) {
      setScriptType(script.type as "powershell" | "cmd")
      setContent(script.content)
    } else {
      setScriptType("cmd")
      setContent("")
    }
  }

  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onmessage = null
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

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
    setConsoleOpen(true)

    try {
      const res = await fetch("/api/scripts/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script_type: scriptType,
          content: scriptContent,
          mode,
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
          } catch {
            // ignore
          }
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
    return () => {
      disconnectWs()
    }
  }, [disconnectWs])

  const handleCopyAll = async () => {
    const text = output.map((o) => `[${o.stream}] ${o.data}`).join("\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const statusBadge = () => {
    switch (status) {
      case "running": return <Badge variant="default" className="bg-blue-500">Running</Badge>
      case "completed": return <Badge variant="secondary">Completed</Badge>
      case "failed": return <Badge variant="destructive">Failed</Badge>
      case "timed_out": return <Badge variant="destructive">Timed Out</Badge>
      default: return null
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">Script Engine</h1>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Script</label>
            <select
              value={predefined}
              onChange={(e) => handlePredefinedChange(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {PREDEFINED.map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
            <div className="flex h-9 rounded-md border border-input overflow-hidden">
              <button
                onClick={() => setScriptType("powershell")}
                className={cn("px-3 text-sm transition-colors", scriptType === "powershell" ? "bg-primary text-primary-foreground" : "bg-transparent")}
              >
                PS
              </button>
              <button
                onClick={() => setScriptType("cmd")}
                className={cn("px-3 text-sm transition-colors", scriptType === "cmd" ? "bg-primary text-primary-foreground" : "bg-transparent")}
              >
                CMD
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Mode</label>
            <div className="flex h-9 rounded-md border border-input overflow-hidden">
              <button
                onClick={() => setMode("live")}
                className={cn("px-3 text-sm transition-colors", mode === "live" ? "bg-primary text-primary-foreground" : "bg-transparent")}
              >
                Live
              </button>
              <button
                onClick={() => setMode("wait")}
                className={cn("px-3 text-sm transition-colors", mode === "wait" ? "bg-primary text-primary-foreground" : "bg-transparent")}
              >
                Wait
              </button>
            </div>
          </div>
          <div className="self-end">
            <Button onClick={handleRun} disabled={running}>
              <Play className="h-4 w-4 mr-1" />
              {running ? "Running..." : "Run"}
            </Button>
          </div>
        </div>

        {(predefined === "Custom" || !PREDEFINED.find((p) => p.label === predefined)?.type) && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Script Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter PowerShell or CMD commands..."
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm font-mono resize-y min-h-[80px]"
            />
          </div>
        )}
      </div>

      {localError && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{localError}</span>
        </div>
      )}

      <Sheet open={consoleOpen} onOpenChange={setConsoleOpen}>
        <SheetContent side="bottom" className="h-[60vh] max-h-[500px] p-0 flex flex-col">
          <SheetHeader className="p-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SheetTitle>Console</SheetTitle>
                {statusBadge()}
              </div>
              <Button variant="ghost" size="sm" onClick={handleCopyAll}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy All"}
              </Button>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex border-b shrink-0">
              <button className="px-4 py-2 text-sm font-medium border-b-2 border-primary">
                Output {errorCount > 0 && <Badge variant="destructive" className="ml-1">{errorCount}</Badge>}
              </button>
            </div>
            <div ref={outputRef} className="flex-1 overflow-auto p-4 font-mono text-sm space-y-1 bg-black/5">
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
                    <>▸ {line.data}</>
                  ) : line.stream === "stderr" ? (
                    <><span className="text-xs text-destructive">[stderr]</span> {line.data}</>
                  ) : (
                    line.data
                  )}
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
