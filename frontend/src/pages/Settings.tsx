import { useState, useEffect, useRef } from "react"
import {
  Key, Shield, Eye, EyeOff, Download, FolderKanban, Server, Globe, AlertTriangle, Check, Copy, RefreshCw, FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useTunnelStore } from "@/lib/store"

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

  // Revoke dialog
  const [showRevokeDialog, setShowRevokeDialog] = useState(false)

  // Tunnel
  const tunnel = useTunnelStore()
  const [tunnelLoading, setTunnelLoading] = useState(false)

  // Load initial data
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

  const handleRevokeAll = async () => {
    try {
      const res = await fetch("/api/settings/revoke-all", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        showSuccess("All sessions revoked. You will be logged out.")
        setTimeout(() => { window.location.href = "/login" }, 1500)
      } else {
        showError(data.message || "Failed")
      }
    } catch { showError("Network error") }
    setShowRevokeDialog(false)
  }

  const handleBrowseFolder = () => {
    folderInputRef.current?.setAttribute("webkitdirectory", "")
    folderInputRef.current?.click()
  }

  const handleFolderSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const file = files[0]
      const abs = (file as any).path as string | undefined
      const rel = file.webkitRelativePath
      if (abs && rel) {
        const dir = abs.slice(0, -rel.length)
        if (browseTarget === "allowed") setNewAllowed(dir)
        else setNewBlocked(dir)
      }
    }
    e.target.value = ""
    folderInputRef.current?.removeAttribute("webkitdirectory")
  }

  const handleExportDb = () => {
    window.open("/api/settings/export-db", "_blank")
  }

  const handleDownloadLogs = () => {
    window.open("/api/settings/download-logs", "_blank")
  }

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
    if (val.trim() && !list.includes(val.trim())) {
      setter([...list, val.trim()])
    }
  }

  const removePath = (list: string[], setter: (v: string[]) => void, idx: number) => {
    setter(list.filter((_, i) => i !== idx))
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-600">
          <Check className="h-4 w-4" />
          <span>{success}</span>
        </div>
      )}

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="font-medium text-sm">Change Password</h3>
            <div className="relative">
              <Input type={showPw ? "text" : "password"} placeholder="Current password" value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)} />
            </div>
            <div className="relative">
              <Input type={showPw ? "text" : "password"} placeholder="New password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)} />
              <button onClick={() => setShowPw(!showPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Input type="password" placeholder="Confirm new password" value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)} />
            <Button onClick={handleChangePassword} size="sm"><Key className="h-4 w-4 mr-1" /> Update Password</Button>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-sm">Two-Factor Authentication (TOTP)</h3>
            {totpStep === "idle" && (
              <Button onClick={handleResetTotp} size="sm" variant="outline">Reset TOTP</Button>
            )}
            {totpStep === "verify" && totpQr && (
              <div className="space-y-3">
                <img src={totpQr} alt="TOTP QR Code" className="w-40 h-40" />
                <p className="text-xs text-muted-foreground">Scan this QR with your authenticator app, then enter the 6-digit code:</p>
                <div className="flex gap-2">
                  <Input placeholder="000000" value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                    className="w-32" maxLength={6} />
                  <Button onClick={handleVerifyTotp} size="sm" disabled={totpCode.length !== 6}>Verify</Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-sm">Recovery Codes</h3>
            {recoveryCodes.length > 0 && showCodes && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {recoveryCodes.map((code, i) => (
                    <div key={i} className="rounded border px-3 py-1.5 bg-muted/30">
                      {code}
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" onClick={() => {
                  navigator.clipboard.writeText(recoveryCodes.join("\n"))
                  setCodesCopied(true)
                  setTimeout(() => setCodesCopied(false), 2000)
                }}>
                  {codesCopied ? <><Check className="h-4 w-4 mr-1" /> Copied</> : <><Copy className="h-4 w-4 mr-1" /> Copy all</>}
                </Button>
              </div>
            )}
            <Button onClick={handleRegenCodes} size="sm" variant="outline">
              <RefreshCw className="h-4 w-4 mr-1" /> Regenerate Codes
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-sm">Session Management</h3>
            <Button onClick={() => setShowRevokeDialog(true)} size="sm" variant="destructive">
              <Shield className="h-4 w-4 mr-1" /> Revoke All Devices
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Data & Maintenance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" /> Data & Maintenance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={handleExportDb} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" /> Export Database
          </Button>
          <Button onClick={handleDownloadLogs} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" /> Download Logs
          </Button>
        </CardContent>
      </Card>

      {/* Tunnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" /> Cloudflare Tunnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status: </span>
            <span className={`text-sm ${tunnel.status === "running" ? "text-green-500" : tunnel.status === "failed" ? "text-red-500" : tunnel.status === "downloading" || tunnel.status === "starting" ? "text-yellow-500" : "text-muted-foreground"}`}>
              {tunnel.status.charAt(0).toUpperCase() + tunnel.status.slice(1)}
            </span>
          </div>
          {tunnel.url && (
            <div className="text-sm">
              <span className="text-muted-foreground">URL: </span>
              <a href={tunnel.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {tunnel.url}
              </a>
            </div>
          )}
          {tunnel.error && (
            <p className="text-sm text-red-500">Error: {tunnel.error}</p>
          )}
          <div className="flex gap-2">
            {tunnel.status === "running" ? (
              <Button onClick={handleTunnelStop} size="sm" variant="destructive" disabled={tunnelLoading}>
                Stop Tunnel
              </Button>
            ) : tunnel.status === "idle" || tunnel.status === "failed" ? (
              <Button onClick={handleTunnelStart} size="sm" disabled={tunnelLoading}>
                Start Tunnel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="font-medium text-sm flex items-center gap-2"><FolderKanban className="h-4 w-4" /> File Access Paths</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="allowed-paths" className="text-xs text-muted-foreground mb-1 block">Allowed Paths</label>
                <div className="flex gap-2 mb-2">
                  <Input id="allowed-paths" placeholder="C:\Users\..." value={newAllowed} onChange={(e) => setNewAllowed(e.target.value)} />
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
                <label htmlFor="blocked-paths" className="text-xs text-muted-foreground mb-1 block">Blocked Paths</label>
                <div className="flex gap-2 mb-2">
                  <Input id="blocked-paths" placeholder="C:\Windows\..." value={newBlocked} onChange={(e) => setNewBlocked(e.target.value)} />
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
            <h3 className="font-medium text-sm flex items-center gap-2"><Server className="h-4 w-4" /> Local Server Port</h3>
            <div className="flex gap-2">
              <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="w-24" min={1024} max={65535} />
              <Button onClick={handleSavePort} size="sm">Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">Requires app restart to take effect</p>
          </div>

        </CardContent>
      </Card>

      <input ref={folderInputRef} type="file" className="hidden" onChange={handleFolderSelected} />

      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke All Devices</AlertDialogTitle>
            <AlertDialogDescription>
              This will log out all active sessions, including your current one. You will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevokeAll} className="bg-destructive hover:bg-destructive/90">
              Revoke All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
