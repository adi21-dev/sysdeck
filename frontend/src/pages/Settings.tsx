import { useState, useEffect, useRef } from "react"
import {
  Shield, Eye, EyeOff, Download, Server, Globe, AlertTriangle, Check, Copy, RefreshCw, FolderOpen, Monitor, Key,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTunnelStore } from "@/lib/store"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function WolSection() {
  const [macs, setMacs] = useState<{label: string; mac: string}[]>([])
  const [label, setLabel] = useState("")
  const [mac, setMac] = useState("")
  const [waking, setWaking] = useState<string | null>(null)

  const fetchMacs = () => {
    fetch("/api/wol/macs").then(r => r.json()).then(d => {
      if (d.success) setMacs(d.macs || [])
    }).catch(() => {})
  }

  useEffect(() => { fetchMacs() }, [])

  const addMac = async () => {
    if (!label.trim() || !mac.trim()) return
    const res = await fetch("/api/wol/macs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({label: label.trim(), mac: mac.trim()}),
    })
    const d = await res.json()
    if (d.success) { setMacs(d.macs); setLabel(""); setMac("") }
  }

  const deleteMac = async (m: string) => {
    const res = await fetch("/api/wol/macs/delete", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({mac: m}),
    })
    const d = await res.json()
    if (d.success) setMacs(d.macs)
  }

  const wake = async (m: {label: string; mac: string}) => {
    setWaking(m.mac)
    await fetch("/api/wol/wake", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({mac: m.mac}),
    })
    setTimeout(() => setWaking(null), 2000)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} className="flex-1" />
        <Input placeholder="XX:XX:XX:XX:XX:XX" value={mac} onChange={e => setMac(e.target.value)} className="w-44 font-mono text-xs" />
        <Button size="sm" onClick={addMac} disabled={!label.trim() || !mac.trim()}>Save</Button>
      </div>
      <div className="space-y-2">
        {macs.length === 0 && <p className="text-sm text-muted-foreground">No saved MAC addresses</p>}
        {macs.map((m, i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground font-mono">{m.mac}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => wake(m)} disabled={waking === m.mac}>
                {waking === m.mac ? "Sent" : "Wake"}
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMac(m.mac)}>×</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Password
  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [showPw, setShowPw] = useState(false)

  // TOTP
  const [totpQr, setTotpQr] = useState<string | null>(null)
  const [totpSecret, setTotpSecret] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [totpStep, setTotpStep] = useState<"idle" | "qr" | "verify">("idle")

  // Recovery codes
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [showCodes, setShowCodes] = useState(false)
  const [codesCopied, setCodesCopied] = useState(false)

  // Paths
  const [allowedPaths, setAllowedPaths] = useState<string[]>([])
  const [blockedPaths, setBlockedPaths] = useState<string[]>([])
  const [newAllowed, setNewAllowed] = useState("")
  const [newBlocked, setNewBlocked] = useState("")

  // Browse folder
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [browseTarget, setBrowseTarget] = useState<"allowed" | "blocked">("allowed")

  // Port
  const [port, setPort] = useState("3939")

  // Sessions
  const [sessions, setSessions] = useState<any[]>([])
  const [currentJti, setCurrentJti] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<{ jti: string; type: "one" | "all" } | null>(null)

  // Revoke dialog
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)

  // Tunnel
  const tunnel = useTunnelStore()
  const [tunnelLoading, setTunnelLoading] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [relayLoading, setRelayLoading] = useState(false)

  const fetchSessions = () => {
    fetch("/api/settings/sessions").then((r) => r.json()).then((d) => {
      if (d.success) {
        setSessions(d.sessions || [])
        setCurrentJti(d.current_jti || null)
      }
    }).catch(() => {})
  }

  useEffect(() => {
    fetch("/api/settings/port").then((r) => r.json()).then((d) => {
      if (d.success) setPort(String(d.port))
    }).catch(() => {})
    fetch("/api/settings/paths").then((r) => r.json()).then((d) => {
      if (d.success) {
        setAllowedPaths(d.allowed || [])
        setBlockedPaths(d.blocked || [])
      }
    }).catch(() => {})
    fetch("/api/tunnel/status").then((r) => r.json()).then((d) => {
      if (d.success) tunnel.setTunnel({ status: d.status, url: d.url ?? null })
    }).catch(() => {})
    fetch("/api/settings/relay").then((r) => r.json()).then((d) => {
      if (d.success) setRelayEnabled(d.enabled)
    }).catch(() => {})
    fetchSessions()
  }, [])

  const showError = (msg: string) => { setError(msg); setSuccess(null) }
  const showSuccess = (msg: string) => { setSuccess(msg); setError(null) }

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { showError("Passwords do not match"); return }
    if (newPw.length < 8) { showError("Password must be at least 8 characters"); return }
    try {
      const res = await fetch("/api/settings/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      const data = await res.json()
      if (data.success) {
        showSuccess("Password changed")
        setCurrentPw(""); setNewPw(""); setConfirmPw("")
      } else {
        showError(data.message || "Failed")
      }
    } catch { showError("Network error") }
  }

  const handleResetTotp = async () => {
    try {
      const res = await fetch("/api/settings/reset-totp", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        setTotpQr(data.qr_svg)
        setTotpSecret(data.secret)
        setTotpStep("verify")
        setTotpCode("")
      } else {
        showError(data.message || "Failed")
      }
    } catch { showError("Network error") }
  }

  const handleVerifyTotp = async () => {
    if (!totpSecret) return
    try {
      const res = await fetch("/api/settings/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: totpSecret, code: totpCode }),
      })
      const data = await res.json()
      if (data.success) {
        showSuccess("TOTP reset complete")
        setTotpStep("idle")
        setTotpQr(null)
        setTotpSecret(null)
        setTotpCode("")
      } else {
        showError(data.message || "Invalid code")
      }
    } catch { showError("Network error") }
  }

  const handleRegenCodes = async () => {
    try {
      const res = await fetch("/api/settings/recovery-codes/regenerate", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        setRecoveryCodes(data.codes)
        setShowCodes(true)
        showSuccess("Recovery codes regenerated")
      } else {
        showError(data.message || "Failed")
      }
    } catch { showError("Network error") }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    const { jti, type } = revokeTarget
    const url = type === "all" ? "/api/settings/revoke-all" : "/api/settings/sessions/revoke"
    const body = type === "all" ? undefined : JSON.stringify({ jti })
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      })
      const data = await res.json()
      if (data.success) {
        if (type === "all" || jti === currentJti) {
          showSuccess("Session revoked. You will be logged out.")
          setTimeout(() => { window.location.href = "/login" }, 1500)
        } else {
          showSuccess("Session revoked")
          fetchSessions()
        }
      } else {
        showError(data.message || "Failed")
      }
    } catch { showError("Network error") }
    setShowRevokeDialog(false)
    setRevokeTarget(null)
  }

  const handleBrowseFolder = () => {
    folderInputRef.current?.click()
  }

  const handleFolderSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const file = files[0]
      const abs = (file as any).path as string | undefined
      if (abs) {
        const dir = file.webkitRelativePath
          ? abs.slice(0, -file.webkitRelativePath.length)
          : abs.includes("\\") ? abs.slice(0, abs.lastIndexOf("\\")) : abs
        if (browseTarget === "allowed") setNewAllowed(dir)
        else setNewBlocked(dir)
      }
    }
    e.target.value = ""
  }

  const handleExportDb = () => { window.open("/api/settings/export-db", "_blank") }
  const handleDownloadLogs = () => { window.open("/api/settings/download-logs", "_blank") }

  const handleSavePaths = async () => {
    try {
      const res = await fetch("/api/settings/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: allowedPaths, blocked: blockedPaths }),
      })
      const data = await res.json()
      if (data.success) showSuccess("Paths saved")
      else showError(data.message || "Failed")
    } catch { showError("Network error") }
  }

  const handleSavePort = async () => {
    const p = parseInt(port, 10)
    if (isNaN(p) || p < 1024 || p > 65535) { showError("Port must be 1024-65535"); return }
    try {
      const res = await fetch("/api/settings/port", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: p }),
      })
      const data = await res.json()
      if (data.success) showSuccess(data.message || "Port saved")
      else showError(data.message || "Failed")
    } catch { showError("Network error") }
  }

  const handleTunnelStart = async () => {
    setTunnelLoading(true)
    try {
      const res = await fetch("/api/tunnel/start", { method: "POST" })
      const data = await res.json()
      if (data.success) showSuccess("Tunnel starting...")
      else showError(data.error || "Failed")
    } catch { showError("Network error") }
    setTunnelLoading(false)
  }

  const handleToggleRelay = async () => {
    setRelayLoading(true)
    try {
      const res = await fetch("/api/settings/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !relayEnabled }),
      })
      const data = await res.json()
      if (data.success) {
        setRelayEnabled(!relayEnabled)
        showSuccess(data.message)
      }
    } catch { showError("Failed to update auto-start") }
    setRelayLoading(false)
  }

  const handleTunnelStop = async () => {
    setTunnelLoading(true)
    try {
      const res = await fetch("/api/tunnel/stop", { method: "POST" })
      const data = await res.json()
      if (data.success) showSuccess("Tunnel stopped")
      else showError(data.error || "Failed")
    } catch { showError("Network error") }
    setTunnelLoading(false)
  }

  const addPath = (list: string[], setter: (v: string[]) => void, val: string) => {
    if (val.trim() && !list.includes(val.trim())) setter([...list, val.trim()])
  }

  const removePath = (list: string[], setter: (v: string[]) => void, idx: number) => {
    setter(list.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          <span>{success}</span>
        </div>
      )}

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Change Password</h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label htmlFor="settings-current-pw" className="block text-sm font-medium mb-2">Current Password</label>
            <input
              id="settings-current-pw"
              type={showPw ? "text" : "password"}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div>
            <label htmlFor="settings-new-pw" className="block text-sm font-medium mb-2">New Password</label>
            <div className="relative">
              <input
                id="settings-new-pw"
                type={showPw ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 pr-10"
              />
              <button
                onClick={() => setShowPw(!showPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="settings-confirm-pw" className="block text-sm font-medium mb-2">Confirm New Password</label>
            <input
              id="settings-confirm-pw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <Button onClick={handleChangePassword} size="sm"><Key className="h-4 w-4 mr-1" /> Update Password</Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Two-Factor Authentication</h3>
        {totpStep === "idle" && (
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50">
            <div>
              <p className="font-medium">TOTP Authentication</p>
              <p className="text-sm text-muted-foreground">Currently enabled</p>
            </div>
            <Button onClick={handleResetTotp} size="sm" variant="outline">Reset TOTP</Button>
          </div>
        )}
        {totpStep === "verify" && totpQr && (
          <div className="space-y-3">
            <img src={totpQr} alt="TOTP QR Code" className="w-40 h-40" />
            <p className="text-xs text-muted-foreground">Scan this QR with your authenticator app, then enter the 6-digit code:</p>
            <div className="flex gap-2">
              <Input placeholder="000000" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} className="w-32" maxLength={6} />
              <Button onClick={handleVerifyTotp} size="sm" disabled={totpCode.length !== 6}>Verify</Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Recovery Codes</h3>
        {recoveryCodes.length > 0 && showCodes && (
          <div className="p-4 rounded-lg border bg-muted/50 mb-4">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recoveryCodes.map((code, i) => (
                <code key={i}>{code}</code>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => {
              navigator.clipboard.writeText(recoveryCodes.join("\n"))
              setCodesCopied(true)
              setTimeout(() => setCodesCopied(false), 2000)
            }} className="mt-2">
              {codesCopied ? <><Check className="h-4 w-4 mr-1" /> Copied</> : <><Copy className="h-4 w-4 mr-1" /> Copy all</>}
            </Button>
          </div>
        )}
        <Button onClick={handleRegenCodes} size="sm" variant="outline">
          <RefreshCw className="h-4 w-4 mr-1" /> Generate New Codes
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Active Sessions</h3>
        <div className="space-y-3">
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No active sessions</p>
          )}
          {sessions.map((s: any) => (
            <div key={s.jti} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Monitor className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {s.jti.slice(0, 8)}...
                    {s.jti === currentJti && (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium ml-2">Current</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(s.created_at * 1000).toLocaleString()}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setRevokeTarget({ jti: s.jti, type: "one" }); setShowRevokeDialog(true) }}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
        <Button
          onClick={() => { setRevokeTarget({ jti: "", type: "all" }); setShowRevokeDialog(true) }}
          size="sm" variant="destructive" className="mt-4"
        >
          <Shield className="h-4 w-4 mr-1" /> Revoke All Sessions
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Remote Access</h3>
        <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50 mb-4">
          <div>
            <p className="font-medium">Cloudflare Tunnel</p>
            <p className="text-sm text-muted-foreground">Status: {tunnel.status}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${tunnel.status === "running" ? "bg-green-500" : tunnel.status === "failed" ? "bg-red-500" : tunnel.status === "idle" ? "bg-gray-400" : "bg-yellow-500 status-dot"}`} />
            <span className={`text-sm font-medium ${tunnel.status === "running" ? "text-green-600 dark:text-green-400" : tunnel.status === "failed" ? "text-destructive" : tunnel.status === "idle" ? "text-muted-foreground" : "text-muted-foreground"}`}>
              {tunnel.status === "running" ? "Connected" : tunnel.status === "failed" ? "Disconnected" : tunnel.status === "idle" ? "Stopped" : "Connecting"}
            </span>
          </div>
        </div>
        {tunnel.url && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-background">
            <code className="flex-1 text-sm truncate">{tunnel.url}</code>
            <button className="p-2 rounded hover:bg-accent" onClick={() => {
              navigator.clipboard.writeText(tunnel.url!)
              showSuccess("URL copied")
            }}>
              <Copy className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex gap-2 mt-4">
          {tunnel.status === "running" ? (
            <Button onClick={handleTunnelStop} size="sm" variant="destructive" disabled={tunnelLoading}>Stop Tunnel</Button>
          ) : tunnel.status === "idle" || tunnel.status === "failed" ? (
            <Button onClick={handleTunnelStart} size="sm" disabled={tunnelLoading}>Start Tunnel</Button>
          ) : (
            <Button size="sm" disabled>
              {tunnel.status === "downloading" ? "Downloading..." : tunnel.status === "starting" ? "Starting..." : "—"}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4 mt-4">
          <div>
            <p className="text-sm font-medium">Auto-start Tunnel</p>
            <p className="text-xs text-muted-foreground">Start tunnel automatically when the app launches</p>
          </div>
          <Button
            size="sm"
            variant={relayEnabled ? "default" : "outline"}
            disabled={relayLoading}
            onClick={handleToggleRelay}
          >
            {relayEnabled ? "On" : "Off"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Wake-on-LAN</h3>
        <WolSection />
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-4">Configuration</h3>
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium">File Access Paths</label>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Allowed Paths</p>
                <div className="flex gap-2 mb-2">
                  <Input placeholder="C:\Users\..." value={newAllowed} onChange={(e) => setNewAllowed(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={() => { setBrowseTarget("allowed"); handleBrowseFolder() }}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { addPath(allowedPaths, setAllowedPaths, newAllowed); setNewAllowed("") }}>Add</Button>
                </div>
                <div className="space-y-1">
                  {allowedPaths.map((p, i) => (
                    <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-xs">
                      <span className="truncate">{p}</span>
                      <button onClick={() => removePath(allowedPaths, setAllowedPaths, i)} className="text-destructive ml-1 shrink-0">×</button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Blocked Paths</p>
                <div className="flex gap-2 mb-2">
                  <Input placeholder="C:\Windows\..." value={newBlocked} onChange={(e) => setNewBlocked(e.target.value)} />
                  <Button size="sm" variant="outline" onClick={() => { setBrowseTarget("blocked"); handleBrowseFolder() }}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { addPath(blockedPaths, setBlockedPaths, newBlocked); setNewBlocked("") }}>Add</Button>
                </div>
                <div className="space-y-1">
                  {blockedPaths.map((p, i) => (
                    <div key={i} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-xs">
                      <span className="truncate">{p}</span>
                      <button onClick={() => removePath(blockedPaths, setBlockedPaths, i)} className="text-destructive ml-1 shrink-0">×</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Button onClick={handleSavePaths} size="sm">Save Paths</Button>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Local Server Port</label>
            <div className="flex gap-2">
              <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="w-24" min={1024} max={65535} />
              <Button onClick={handleSavePort} size="sm">Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">Requires app restart to take effect</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleExportDb} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" /> Export Database
            </Button>
            <Button onClick={handleDownloadLogs} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" /> Download Logs
            </Button>
          </div>
        </div>
      </div>

      <input ref={folderInputRef} type="file" className="hidden" onChange={handleFolderSelected} />

      <AlertDialog open={showRevokeDialog} onOpenChange={(o) => { setShowRevokeDialog(o); if (!o) setRevokeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{revokeTarget?.type === "all" ? "Revoke All Devices" : "Revoke Session"}</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.type === "all"
                ? "This will log out all active sessions, including your current one. You will need to sign in again."
                : "This will log out the selected session."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-destructive hover:bg-destructive/90">
              {revokeTarget?.type === "all" ? "Revoke All" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
