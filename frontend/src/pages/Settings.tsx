import { useState, useEffect, useRef } from "react"
import {
  Shield, Eye, EyeOff, Download, AlertTriangle, Check, Copy, RefreshCw, FolderOpen, Monitor, Key, Server, HardDrive, Trash2, KeyRound, Wifi
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"

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
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input placeholder="Device Label" value={label} onChange={e => setLabel(e.target.value)} className="flex-grow h-11 md:h-10 text-base md:text-sm" />
        <Input placeholder="MAC Address (e.g. 00:11:22:33:44:55)" value={mac} onChange={e => setMac(e.target.value)} className="w-full sm:w-56 font-mono text-base md:text-sm h-11 md:h-10" />
        <Button size="touch" className="h-11 md:h-10 px-5 font-semibold" onClick={addMac} disabled={!label.trim() || !mac.trim()}>Save Mac</Button>
      </div>
      
      <div className="space-y-2">
        {macs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-border/40 rounded-2xl bg-muted/10">
            <p className="text-xs text-muted-foreground/60 leading-normal">Configure Wake-on-LAN parameters above to start booting devices remotely.</p>
          </div>
        )}
        
        {macs.map((m, i) => (
          <div key={i} className="flex items-center justify-between p-3.5 rounded-2xl border border-border/40 bg-muted/10">
            <div>
              <p className="text-sm font-semibold text-foreground/80">{m.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{m.mac}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-9 text-xs rounded-xl" onClick={() => wake(m)} disabled={waking === m.mac}>
                {waking === m.mac ? "Signal Sent" : "Wake Device"}
              </Button>
              <Button size="sm" variant="ghost" className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/10" onClick={() => deleteMac(m.mac)}>×</Button>
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
  const [activeAnchor, setActiveAnchor] = useState("security")

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

  // Uninstall
  const [showUninstallDialog, setShowUninstallDialog] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [uninstallErr, setUninstallErr] = useState<string | null>(null)

  const fetchSessions = () => {
    setSessionErr(null)
    fetch("/api/settings/sessions").then((r) => r.json()).then((d) => {
      if (d.success) {
        setSessions(d.sessions || [])
        setCurrentJti(d.current_jti || null)
      } else setSessionErr(d.message || "Failed to load sessions")
    }).catch(() => setSessionErr("Failed to load sessions"))
  }

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

    // Setup intersection observer to highlight sticky pills on scroll
    const sections = ["security", "network", "paths", "maintenance"]
    const observers = sections.map((sec) => {
      const el = document.getElementById(sec)
      if (!el) return null
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveAnchor(sec)
        },
        { rootMargin: "-110px 0px -60% 0px" }
      )
      obs.observe(el)
      return { obs, el }
    })

    return () => {
      observers.forEach((o) => o?.obs.disconnect())
    }
  }, [])

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

  const handleUninstall = async () => {
    setUninstalling(true)
    setUninstallErr(null)
    setShowUninstallDialog(false)
    try {
      const res = await fetch("/api/system/uninstall", { method: "POST" })
      const data = await res.json()
      if (!data.success) {
        setUninstallErr(data.message || "Uninstall failed")
        setUninstalling(false)
      }
    } catch {
      setUninstallErr("Failed to start uninstall")
      setUninstalling(false)
    }
  }

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

  const scrollToAnchor = (id: string) => {
    if (navigator.vibrate) navigator.vibrate(10)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: "smooth" })
  }

  const settingsNavItems = [
    { id: "security", label: "Security", icon: Shield },
    { id: "network", label: "Network", icon: Server },
    { id: "paths", label: "Paths", icon: FolderOpen },
    { id: "maintenance", label: "Maintenance", icon: Trash2 },
  ]

  return (
    <div className="space-y-6">
      {success && (
        <div className="fixed top-[60px] right-4 md:right-8 z-50 flex items-center gap-2 rounded-xl bg-green-500/10 backdrop-blur-md px-4 py-3 text-xs font-bold text-success border border-green-500/20 shadow-md animate-fade-in">
          <Check className="h-4.5 w-4.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Sticky Index Pill Navigation */}
      <div className="sticky top-[52px] md:top-0 z-20 backdrop-blur-md py-2 border-b border-border/20 bg-background/80 flex gap-2 overflow-x-auto scrollbar-none select-none">
        {settingsNavItems.map((item) => {
          const Icon = item.icon
          const isActive = activeAnchor === item.id
          return (
            <button
              key={item.id}
              onClick={() => scrollToAnchor(item.id)}
              className={cn(
                "flex items-center gap-2 shrink-0 px-4 py-2 rounded-2xl text-xs font-semibold uppercase tracking-wider transition-all duration-200 snap-start active:scale-95 touch-target",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 border border-border/30 text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6 max-w-5xl">
        
        {/* ── SECURITY SECTION ── */}
        <section id="security" className="scroll-mt-[108px] space-y-5">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Security Configuration</h2>
          
          {/* Password change card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Key className="h-4.5 w-4.5 text-primary" /> Change Admin Password</span>
              <InfoButton content="Allows changing your SysDeck console password. Minimum 8 characters." />
            </h3>
            
            <div className="space-y-4 max-w-md">
              {errors.password && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{errors.password}</span>
                </div>
              )}
              
              <div className="space-y-1.5">
                <label htmlFor="settings-current-pw" className="text-xs font-semibold text-muted-foreground">Current Password</label>
                <Input
                  id="settings-current-pw"
                  type={showPw ? "text" : "password"}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="h-11 md:h-10 text-base md:text-sm"
                />
              </div>
              
              <div className="space-y-1.5">
                <label htmlFor="settings-new-pw" className="text-xs font-semibold text-muted-foreground">New Password</label>
                <div className="relative">
                  <Input
                    id="settings-new-pw"
                    type={showPw ? "text" : "password"}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="h-11 md:h-10 text-base md:text-sm pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 touch-target text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="h-5 w-5 md:h-4 md:w-4" /> : <Eye className="h-5 w-5 md:h-4 md:w-4" />}
                  </button>
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label htmlFor="settings-confirm-pw" className="text-xs font-semibold text-muted-foreground">Confirm New Password</label>
                <Input
                  id="settings-confirm-pw"
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="h-11 md:h-10 text-base md:text-sm"
                />
              </div>
              
              <Button onClick={handleChangePassword} size="sm" disabled={isSubmittingPw} className="h-10 rounded-xl px-5 font-semibold">
                <Key className="h-4 w-4 mr-1.5" /> {isSubmittingPw ? "Updating..." : "Update Password"}
              </Button>
            </div>
          </Card>

          {/* Two-Factor Auth card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Shield className="h-4.5 w-4.5 text-primary" /> Two-Factor Authentication</span>
              <InfoButton content="Enable or reset your authenticator app configurations." />
            </h3>
            
            <div className="space-y-4">
              {errors.totp && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{errors.totp}</span>
                </div>
              )}
              
              {totpStep === "idle" && (
                <div className="flex items-center justify-between p-4 rounded-2xl border border-border/40 bg-muted/10">
                  <div>
                    <p className="text-sm font-semibold">TOTP Authenticator</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Currently active on this agent</p>
                  </div>
                  <Button onClick={handleResetTotp} size="sm" variant="outline" className="h-9 rounded-xl text-xs">Reset TOTP</Button>
                </div>
              )}
              
              {totpStep === "verify" && totpQr && (
                <div className="space-y-4 max-w-sm">
                  <div className="flex justify-center p-3 rounded-2xl bg-white border border-border/40 shadow-inner w-44 mx-auto">
                    <img src={totpQr} alt="TOTP QR Code" className="w-40 h-40" />
                  </div>
                  <p className="text-xs text-muted-foreground leading-normal text-center">Scan this QR with your authenticator, then enter the 6-digit verification code below:</p>
                  <div className="flex gap-2">
                    <Input placeholder="000000" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} className="h-10 text-center font-semibold text-base" maxLength={6} />
                    <Button onClick={handleVerifyTotp} size="sm" className="h-10 rounded-xl font-semibold px-4" disabled={totpCode.length !== 6}>Verify</Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Recovery codes card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><KeyRound className="h-4.5 w-4.5 text-primary" /> Backup Recovery Codes</span>
              <InfoButton content="Generate new backup codes to bypass TOTP if you lose your device." />
            </h3>
            
            <div className="space-y-4">
              {errors.codes && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{errors.codes}</span>
                </div>
              )}
              
              {recoveryCodes.length > 0 && showCodes && (
                <div className="p-4 rounded-2xl border border-border/40 bg-muted/10 space-y-3">
                  <div className="grid grid-cols-2 gap-2.5 font-mono text-xs font-semibold">
                    {recoveryCodes.map((code, i) => (
                      <code key={i} className="bg-background/80 p-2 rounded-lg border border-border/20 text-center tracking-wider">{code}</code>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => {
                    navigator.clipboard.writeText(recoveryCodes.join("\n"))
                    setCodesCopied(true)
                    setTimeout(() => setCodesCopied(false), 2000)
                  }} className="h-9 rounded-xl text-xs">
                    {codesCopied ? <><Check className="h-4 w-4 mr-1.5 text-success" /> Copied</> : <><Copy className="h-4 w-4 mr-1.5" /> Copy all</>}
                  </Button>
                </div>
              )}
              
              <Button onClick={handleRegenCodes} size="sm" variant="outline" className="h-9 rounded-xl text-xs font-semibold">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Generate New Backup Codes
              </Button>
            </div>
          </Card>

          {/* Active Sessions card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Monitor className="h-4.5 w-4.5 text-primary" /> Active Login Sessions</span>
              <InfoButton content="Lists active sessions authenticated to this server." />
            </h3>
            
            <div className="space-y-3">
              {sessionErr && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{sessionErr}</span>
                </div>
              )}
              
              {sessions.length === 0 && !sessionErr && (
                <p className="text-center py-6 text-xs text-muted-foreground/60">No active login sessions detected</p>
              )}
              
              {sessions.map((s: any) => (
                <div key={s.jti} className="flex items-center justify-between p-3.5 rounded-2xl border border-border/40 bg-muted/10">
                  <div className="flex items-center gap-3">
                    <Monitor className="w-5 h-5 text-muted-foreground/70" />
                    <div>
                      <p className="text-xs font-semibold text-foreground/80">
                        {s.jti.slice(0, 8)}...
                        {s.jti === currentJti && (
                          <span className="text-[10px] text-green-600 dark:text-green-400 font-bold ml-2 uppercase tracking-wide">Current Device</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(s.created_at * 1000).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs rounded-xl"
                    onClick={() => { setRevokeTarget({ jti: s.jti, type: "one" }); setShowRevokeDialog(true) }}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
              
              <Button
                onClick={() => { setRevokeTarget({ jti: "", type: "all" }); setShowRevokeDialog(true) }}
                size="sm" variant="destructive"
                className="h-9 rounded-xl text-xs font-semibold mt-1"
              >
                <Shield className="h-4 w-4 mr-1.5" /> Revoke All Other Sessions
              </Button>
            </div>
          </Card>
        </section>

        {/* ── NETWORK SECTION ── */}
        <section id="network" className="scroll-mt-[108px] space-y-5">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Network Settings</h2>
          
          {/* Cloudflare Tunnel card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Wifi className="h-4.5 w-4.5 text-primary" /> Remote Cloudflare Relay</span>
              <InfoButton content="Expose this machine securely to the web using Cloudflare Quick Tunnels." />
            </h3>
            
            <div className="space-y-4">
              {tunnelErr && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{tunnelErr}</span>
                </div>
              )}
              
              <div className="flex items-center justify-between p-4 rounded-2xl border border-border/40 bg-muted/10">
                <div>
                  <p className="text-sm font-semibold">Cloudflare Tunnel Status</p>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">Status: {tunnel.status}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${tunnel.status === "running" ? "bg-green-500 shadow-[0_0_8px_hsl(142_65%_40%_/_0.5)]" : tunnel.status === "failed" ? "bg-red-500" : tunnel.status === "idle" ? "bg-muted-foreground/45" : "bg-amber-400 status-dot"}`} />
                  <span className={`text-xs font-bold uppercase tracking-wider ${tunnel.status === "running" ? "text-success" : tunnel.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                    {tunnel.status === "running" ? "Connected" : tunnel.status === "failed" ? "Offline" : tunnel.status === "idle" ? "Stopped" : "Pending"}
                  </span>
                </div>
              </div>
              
              {tunnel.url && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-border/40 bg-background/50">
                  <code className="flex-1 text-xs truncate font-mono select-all font-semibold pl-2">{tunnel.url}</code>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0" onClick={() => {
                    navigator.clipboard.writeText(tunnel.url!)
                    showSuccess("URL copied")
                  }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
              
              <div className="flex gap-2">
                {tunnel.status === "running" ? (
                  <Button onClick={handleTunnelStop} size="sm" variant="destructive" className="h-9 rounded-xl text-xs font-semibold" disabled={tunnelLoading}>Stop Tunnel</Button>
                ) : tunnel.status === "idle" || tunnel.status === "failed" ? (
                  <Button onClick={handleTunnelStart} size="sm" className="h-9 rounded-xl text-xs font-semibold" disabled={tunnelLoading}>Start Tunnel</Button>
                ) : (
                  <Button size="sm" className="h-9 rounded-xl text-xs" disabled>
                    {tunnel.status === "downloading" ? "Downloading dependencies..." : "Initializing..."}
                  </Button>
                )}
              </div>

              <Separator className="bg-border/30" />

              {relayErr && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{relayErr}</span>
                </div>
              )}
              
              <div className="flex items-center justify-between rounded-2xl border border-border/40 p-4 bg-muted/5">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">Auto-start Tunnel Relay</p>
                  <p className="text-xs text-muted-foreground leading-normal max-w-xs">Expose local server to the web automatically when SysDeck starts up.</p>
                </div>
                <Switch
                  checked={relayEnabled}
                  onChange={handleToggleRelay}
                  disabled={relayLoading}
                />
              </div>
            </div>
          </Card>

          {/* Wake-on-LAN card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Monitor className="h-4.5 w-4.5 text-primary" /> Wake-on-LAN (WoL)</span>
              <InfoButton content="Send magic broadcast packets to boot sleeping PCs on your local network." />
            </h3>
            <WolSection />
          </Card>

          {/* Local listen Port card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><HardDrive className="h-4.5 w-4.5 text-primary" /> Listen Port Configuration</span>
              <InfoButton content="Specify backend local listen port. Default is 3939." />
            </h3>
            
            <div className="space-y-4 max-w-xs">
              {portErr && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{portErr}</span>
                </div>
              )}
              
              <div className="flex items-center gap-3">
                <Input id="local-server-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} className="w-28 h-10 text-center font-mono font-bold text-sm" min={1024} max={65535} />
                <Button onClick={handleSavePort} size="sm" className="h-10 rounded-xl font-semibold px-4" disabled={isSavingPort}>{isSavingPort ? "Saving..." : "Save Port"}</Button>
              </div>
              <p className="text-[10px] text-muted-foreground font-semibold leading-none">Requires backend process restart to take effect.</p>
            </div>
          </Card>
        </section>

        {/* ── PATHS SECTION ── */}
        <section id="paths" className="scroll-mt-[108px] space-y-5">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Access Control & Paths</h2>
          
          {/* File access paths card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><FolderOpen className="h-4.5 w-4.5 text-primary" /> Allowed Directory Whitelist</span>
              <InfoButton content="Allowed Paths registers folders you can browse. Blocked Paths overrides allowed directories completely." />
            </h3>
            
            <div className="space-y-5">
              {pathsErr && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive border border-destructive/10">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{pathsErr}</span>
                </div>
              )}
              
              <div className="grid gap-5 md:grid-cols-2">
                {/* Allowed paths list */}
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-0.5">Whitelist Allowed Folders</p>
                  <div className="flex gap-2">
                    <Input placeholder="C:\Users\..." value={newAllowed} onChange={(e) => setNewAllowed(e.target.value)} className="h-10 text-xs" />
                    <Button size="icon" variant="outline" className="h-10 w-10 shrink-0 rounded-xl" onClick={() => { setBrowseTarget("allowed"); handleBrowseFolder() }}>
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-10 px-4 rounded-xl text-xs font-semibold" onClick={() => { addPath(allowedPaths, setAllowedPaths, newAllowed); setNewAllowed("") }}>Add</Button>
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {allowedPaths.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded-xl bg-muted/20 pl-3 pr-1 py-1.5 text-xs border border-border/20">
                        <span className="truncate pr-2 font-medium">{p}</span>
                        <button type="button" onClick={() => removePath(allowedPaths, setAllowedPaths, i)} className="h-7 w-7 flex items-center justify-center text-destructive hover:bg-destructive/10 shrink-0 rounded-lg">×</button>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Blocked paths list */}
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pl-0.5">Blacklist Blocked Folders</p>
                  <div className="flex gap-2">
                    <Input placeholder="C:\Windows\..." value={newBlocked} onChange={(e) => setNewBlocked(e.target.value)} className="h-10 text-xs" />
                    <Button size="icon" variant="outline" className="h-10 w-10 shrink-0 rounded-xl" onClick={() => { setBrowseTarget("blocked"); handleBrowseFolder() }}>
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-10 px-4 rounded-xl text-xs font-semibold" onClick={() => { addPath(blockedPaths, setBlockedPaths, newBlocked); setNewBlocked("") }}>Add</Button>
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {blockedPaths.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded-xl bg-muted/20 pl-3 pr-1 py-1.5 text-xs border border-border/20">
                        <span className="truncate pr-2 font-medium">{p}</span>
                        <button type="button" onClick={() => removePath(blockedPaths, setBlockedPaths, i)} className="h-7 w-7 flex items-center justify-center text-destructive hover:bg-destructive/10 shrink-0 rounded-lg">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              <Button onClick={handleSavePaths} size="sm" className="h-10 px-5 rounded-xl font-semibold shadow-sm" disabled={isSavingPaths}>
                {isSavingPaths ? "Saving Whitelist..." : "Save Path Permissions"}
              </Button>
            </div>
          </Card>
        </section>

        {/* ── MAINTENANCE SECTION ── */}
        <section id="maintenance" className="scroll-mt-[108px] space-y-5">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest pl-1">Server Maintenance</h2>
          
          {/* Backup card */}
          <Card variant="glass" className="p-5 shadow-sm border border-border/40">
            <h3 className="text-sm font-semibold text-foreground/80 mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2"><Download className="h-4.5 w-4.5 text-primary" /> Backup & Export Database</span>
              <InfoButton content="Backup database structure or dump raw logs for troubleshooting." />
            </h3>
            
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleExportDb} variant="outline" size="sm" className="h-9 rounded-xl text-xs font-semibold">
                <Download className="h-4 w-4 mr-1.5" /> Export DB JSON
              </Button>
              <Button onClick={handleDownloadLogs} variant="outline" size="sm" className="h-9 rounded-xl text-xs font-semibold">
                <Download className="h-4 w-4 mr-1.5" /> Download Server Logs
              </Button>
            </div>
          </Card>

          {/* Uninstall card */}
          <Card variant="glass" className="p-5 shadow-sm border border-destructive/20 bg-destructive/5">
            <h3 className="text-sm font-semibold text-destructive mb-3 flex items-center gap-2">
              <Trash2 className="h-4.5 w-4.5" /> Uninstall SysDeck Agent
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4 max-w-lg">
              Permanently deletes all data folders, settings, session histories, and cancels services registry. This action cannot be reverted.
            </p>
            
            {uninstallErr && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-xs mb-4 border border-destructive/10">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{uninstallErr}</span>
              </div>
            )}
            
            <Button variant="destructive" size="sm" className="h-9 px-4 rounded-xl text-xs font-bold shadow-sm" onClick={() => setShowUninstallDialog(true)} disabled={uninstalling}>
              {uninstalling ? "Uninstalling..." : "Uninstall Agent"}
            </Button>
          </Card>
        </section>

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

      <AlertDialog open={showUninstallDialog} onOpenChange={setShowUninstallDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall SysDeck</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all data, logs, and the application. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleUninstall}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full screen uninstall overlay */}
      {uninstalling && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background/90 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-4 animate-fade-in text-center p-4">
            <div className="w-16 h-16 rounded-3xl bg-destructive/10 flex items-center justify-center shadow-lg">
              <Trash2 className="w-8 h-8 text-destructive animate-pulse" />
            </div>
            <h2 className="text-xl font-bold">Uninstalling SysDeck...</h2>
            <p className="text-sm text-muted-foreground">Cleaning local folders. You can safely close this browser window.</p>
          </div>
        </div>
      )}
    </div>
  )
}
