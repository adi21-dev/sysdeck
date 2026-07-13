import { useState, useEffect, useRef } from "react"
import {
  Shield, Eye, EyeOff, Download, AlertTriangle, Check, Copy, RefreshCw, FolderOpen, Monitor, Key, Server, HardDrive,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
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
import { InfoButton } from "@/components/ui/info-button"

export function WolSection() {
  const [macs, setMacs] = useState<{label: string; mac: string}[]>([])
  const [label, setLabel] = useState("")
  const [mac, setMac] = useState("")
  const [waking, setWaking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchMacs = () => {
    fetch("/api/wol/macs").then(r => r.json()).then(d => {
      if (d.success) setMacs(d.macs || [])
    }).catch(() => setError("Failed to load MAC addresses"))
  }

  useEffect(() => { fetchMacs() }, [])

  const addMac = async () => {
    if (!label.trim() || !mac.trim()) return
    setError(null)
    const res = await fetch("/api/wol/macs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({label: label.trim(), mac: mac.trim()}),
    })
    const d = await res.json()
    if (d.success) { setMacs(d.macs); setLabel(""); setMac("") }
    else setError(d.message || "Failed to save")
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
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex gap-2">
        <Input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} className="flex-1" />
        <Input placeholder="XX:XX:XX:XX:XX:XX" value={mac} onChange={e => setMac(e.target.value)} className="w-44 font-mono text-xs" />
        <Button size="sm" onClick={addMac} disabled={!label.trim() || !mac.trim()}>Save</Button>
      </div>
      <div className="space-y-2">
        {macs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
              <Monitor className="w-5 h-5 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No saved MAC addresses</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add a MAC address above to enable Wake-on-LAN</p>
          </div>
        )}
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
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<string | null>(null)

  const setSectionError = (section: string, msg: string) =>
    setErrors((e) => ({ ...e, [section]: msg }))
  const clearSectionError = (section: string) =>
    setErrors((e) => { const n = { ...e }; delete n[section]; return n })
  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(null), 3000) }

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
  const [sessionErr, setSessionErr] = useState<string | null>(null)

  // Revoke dialog
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)

  // Tunnel
  const tunnel = useTunnelStore()
  const [tunnelLoading, setTunnelLoading] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [relayLoading, setRelayLoading] = useState(false)
  const [tunnelErr, setTunnelErr] = useState<string | null>(null)
  const [relayErr, setRelayErr] = useState<string | null>(null)
  const [pathsErr, setPathsErr] = useState<string | null>(null)
  const [portErr, setPortErr] = useState<string | null>(null)

  const fetchSessions = () => {
    setSessionErr(null)
    fetch("/api/settings/sessions").then((r) => r.json()).then((d) => {
      if (d.success) {
        setSessions(d.sessions || [])
        setCurrentJti(d.current_jti || null)
      } else setSessionErr(d.message || "Failed to load sessions")
    }).catch(() => setSessionErr("Failed to load sessions"))
  }

  // Fetch all settings on mount — stable dependency
  useEffect(() => {
    fetch("/api/settings/port").then((r) => r.json()).then((d) => {
      if (d.success) setPort(String(d.port))
    }).catch(() => setPortErr("Failed to load port setting"))
    fetch("/api/settings/paths").then((r) => r.json()).then((d) => {
      if (d.success) {
        setAllowedPaths(d.allowed || [])
        setBlockedPaths(d.blocked || [])
      }
    }).catch(() => setPathsErr("Failed to load path settings"))
    fetch("/api/tunnel/status").then((r) => r.json()).then((d) => {
      if (d.success) useTunnelStore.getState().setTunnel({ status: d.status, url: d.url ?? null })
    }).catch(() => setTunnelErr("Failed to load tunnel status"))
    fetch("/api/settings/relay").then((r) => r.json()).then((d) => {
      if (d.success) setRelayEnabled(d.enabled)
    }).catch(() => setRelayErr("Failed to load relay settings"))
    fetchSessions()
  }, []) // stable mount-only

  const [isSubmittingPw, setIsSubmittingPw] = useState(false)

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { setSectionError("password", "Passwords do not match"); return }
    if (newPw.length < 8) { setSectionError("password", "Password must be at least 8 characters"); return }
    setIsSubmittingPw(true)
    clearSectionError("password")
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
        setSectionError("password", data.message || "Failed")
      }
    } catch { setSectionError("password", "Network error") }
    finally { setIsSubmittingPw(false) }
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
        setSectionError("totp", data.message || "Failed")
      }
    } catch { setSectionError("totp", "Network error") }
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
        setSectionError("totp", data.message || "Invalid code")
      }
    } catch { setSectionError("totp", "Network error") }
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
        setSectionError("codes", data.message || "Failed")
      }
    } catch { setSectionError("codes", "Network error") }
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
        setSectionError("sessions", data.message || "Failed")
      }
    } catch { setSectionError("sessions", "Network error") }
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

  const [isSavingPaths, setIsSavingPaths] = useState(false)

  const handleSavePaths = async () => {
    setIsSavingPaths(true)
    clearSectionError("paths")
    try {
      const res = await fetch("/api/settings/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: allowedPaths, blocked: blockedPaths }),
      })
      const data = await res.json()
      if (data.success) showSuccess("Paths saved")
      else setSectionError("paths", data.message || "Failed")
    } catch { setSectionError("paths", "Network error") }
    finally { setIsSavingPaths(false) }
  }

  const [isSavingPort, setIsSavingPort] = useState(false)

  const handleSavePort = async () => {
    const p = parseInt(port, 10)
    if (isNaN(p) || p < 1024 || p > 65535) { setSectionError("port", "Port must be 1024-65535"); return }
    setIsSavingPort(true)
    clearSectionError("port")
    try {
      const res = await fetch("/api/settings/port", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: p }),
      })
      const data = await res.json()
      if (data.success) showSuccess(data.message || "Port saved")
      else setSectionError("port", data.message || "Failed")
    } catch { setSectionError("port", "Network error") }
    finally { setIsSavingPort(false) }
  }

  const handleTunnelStart = async () => {
    setTunnelLoading(true)
    setTunnelErr(null)
    try {
      const res = await fetch("/api/tunnel/start", { method: "POST" })
      const data = await res.json()
      if (data.success) showSuccess("Tunnel starting...")
      else setTunnelErr(data.error || "Failed")
    } catch { setTunnelErr("Network error") }
    setTunnelLoading(false)
  }

  const handleToggleRelay = async () => {
    setRelayLoading(true)
    setRelayErr(null)
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
    } catch { setRelayErr("Failed to update auto-start") }
    setRelayLoading(false)
  }

  const handleTunnelStop = async () => {
    setTunnelLoading(true)
    setTunnelErr(null)
    try {
      const res = await fetch("/api/tunnel/stop", { method: "POST" })
      const data = await res.json()
      if (data.success) showSuccess("Tunnel stopped")
      else setTunnelErr(data.error || "Failed")
    } catch { setTunnelErr("Network error") }
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
      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-green-500/10 backdrop-blur-sm p-3 text-sm text-green-400 border border-green-500/10">
          <Check className="h-4 w-4" />
          <span>{success}</span>
        </div>
      )}

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Key className="h-4 w-4" />
            Change Password
            <InfoButton content={"Password must be 8+ characters.\n\nExample: after rotating credentials, set a new passphrase here (e.g. \"blue-elephant-jumps-42\")."} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          {errors.password && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{errors.password}</span>
            </div>
          )}
          <div>
            <label htmlFor="settings-current-pw" className="block text-sm font-medium mb-2">Current Password</label>
            <input
              id="settings-current-pw"
              type={showPw ? "text" : "password"}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
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
                className="w-full px-3 py-2 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all pr-10"
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
              className="w-full px-3 py-2 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
            />
          </div>
          <Button onClick={handleChangePassword} size="sm" disabled={isSubmittingPw}>
            <Key className="h-4 w-4 mr-1.5" /> {isSubmittingPw ? "Updating..." : "Update Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Two-Factor Auth */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            Two-Factor Authentication
            <InfoButton content={"TOTP second factor — requires password + 6-digit code from an authenticator app to sign in.\n\nExample: scan the QR with Authy on your phone, enter the code it shows to verify setup."} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {errors.totp && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive mb-4">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{errors.totp}</span>
            </div>
          )}
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
        </CardContent>
      </Card>

      {/* Recovery Codes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" />
            Recovery Codes
            <InfoButton content={"Backup codes for when you can't access your authenticator.\nEach code works exactly once — save them somewhere safe.\n\nExample: store in Bitwarden or print a copy for your wallet before locking yourself out."} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {errors.codes && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive mb-4">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{errors.codes}</span>
            </div>
          )}
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
            <RefreshCw className="h-4 w-4 mr-1.5" /> Generate New Codes
          </Button>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Monitor className="h-4 w-4" />
            Active Sessions
            <InfoButton content={"All active login sessions across devices.\nRevoke any session to force-logout that device.\n\nExample: if you signed in from a shared computer, revoke that session remotely."} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessionErr && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{sessionErr}</span>
            </div>
          )}
          {sessions.length === 0 && !sessionErr && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
                <Monitor className="w-5 h-5 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No active sessions</p>
              <p className="text-xs text-muted-foreground/60 mt-1">All sessions have been signed out or none exist yet</p>
            </div>
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
          <Button
            onClick={() => { setRevokeTarget({ jti: "", type: "all" }); setShowRevokeDialog(true) }}
            size="sm" variant="destructive"
          >
            <Shield className="h-4 w-4 mr-1.5" /> Revoke All Sessions
          </Button>
        </CardContent>
      </Card>

      {/* Remote Access - Cloudflare Tunnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Server className="h-4 w-4" />
            Remote Access
            <InfoButton content={"Cloudflare Tunnel creates a secure outbound tunnel to the internet — no port forwarding needed.\nAuto-start launches the tunnel when the app boots.\n\nExample: start the tunnel, copy the URL, and access your server from any browser anywhere."} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {tunnelErr && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{tunnelErr}</span>
            </div>
          )}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50">
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
          <div className="flex gap-2">
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

          <Separator />

          {relayErr && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{relayErr}</span>
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg border p-4">
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
        </CardContent>
      </Card>

      {/* Wake-on-LAN */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Monitor className="h-4 w-4" />
            Wake-on-LAN
            <InfoButton content={"Send a magic packet to wake a sleeping computer on the LAN.\nTarget needs WoL enabled in BIOS and must be on the same subnet.\n\nExample: save the MAC address of your media server, then wake it remotely instead of walking over to press the power button."} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WolSection />
        </CardContent>
      </Card>

      {/* File Access Paths */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FolderOpen className="h-4 w-4" />
            File Access Paths
            <InfoButton content={"Whitelist directories the file manager can browse.\nPaths not listed here are blocked for security.\nBlocked paths override allowed paths.\n\nExample: allow C:\\Users\\Public\\Share but block C:\\Windows\\System32."} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pathsErr && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{pathsErr}</span>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium">Allowed Paths</p>
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
                    <button onClick={() => removePath(allowedPaths, setAllowedPaths, i)} className="size-6 flex items-center justify-center text-destructive shrink-0 rounded hover:bg-destructive/10">×</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 font-medium">Blocked Paths</p>
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
                    <button onClick={() => removePath(blockedPaths, setBlockedPaths, i)} className="size-6 flex items-center justify-center text-destructive shrink-0 rounded hover:bg-destructive/10">×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Button onClick={handleSavePaths} size="sm" disabled={isSavingPaths}>
            {isSavingPaths ? "Saving..." : "Save Paths"}
          </Button>
        </CardContent>
      </Card>

      {/* Server Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <HardDrive className="h-4 w-4" />
            Server Configuration
            <InfoButton content={"Backend listen port (default 3939). Requires app restart to take effect.\nUse ports above 1024 to avoid admin rights.\n\nExample: change to 9090 if 3939 conflicts with another service."} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {portErr && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{portErr}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="local-server-port" className="text-sm font-medium whitespace-nowrap">Port</label>
            <Input id="local-server-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} className="w-24" min={1024} max={65535} />
            <Button onClick={handleSavePort} size="sm" disabled={isSavingPort}>{isSavingPort ? "Saving..." : "Save"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Requires app restart to take effect</p>
        </CardContent>
      </Card>

      {/* Backup & Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Download className="h-4 w-4" />
            Backup &amp; Export
            <InfoButton content={"Export the full database as a JSON file for backup or inspection.\nDownload logs for troubleshooting — they contain recent server activity without sensitive credentials."} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleExportDb} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1.5" /> Export Database
            </Button>
            <Button onClick={handleDownloadLogs} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1.5" /> Download Logs
            </Button>
          </div>
        </CardContent>
      </Card>

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
