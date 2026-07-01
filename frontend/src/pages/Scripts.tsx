import { useState, useRef, useCallback, useEffect } from "react"
import { Play, Copy, Check, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

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
    setStatus,
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
    return () => { disconnectWs() }
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={predefined}
                onChange={(e) => handlePredefinedChange(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                {PREDEFINED.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
              <select
                value={scriptType}
                onChange={(e) => setScriptType(e.target.value as "powershell" | "cmd")}
                className="px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <option value="powershell">PowerShell</option>
                <option value="cmd">CMD</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === "live"} onChange={() => setMode("live")} className="text-primary" />
                Live Output
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === "wait"} onChange={() => setMode("wait")} className="text-primary" />
                Wait & Show
              </label>
            </div>

            {(predefined === "Custom" || !PREDEFINED.find((p) => p.label === predefined)?.type) && (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter your script here..."
                rows={8}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
              />
            )}

            <Button onClick={handleRun} disabled={running} className="w-full">
              <Play className="h-4 w-4 mr-2" />
              {running ? "Running..." : "Run Script"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Output</h3>
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
            className="bg-muted rounded-lg p-4 font-mono text-xs h-80 overflow-y-auto space-y-1"
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
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{localError}</span>
        </div>
      )}


    </div>
  )
}
