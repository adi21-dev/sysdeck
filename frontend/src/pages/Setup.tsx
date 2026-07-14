import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Check, Copy, Download, Eye, EyeOff, ArrowLeft, ShieldCheck, Smartphone, Globe, Key } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { TotpInput } from "@/components/ui/totp-input"
import { Switch } from "@/components/ui/switch"
import { useAuthStore } from "@/lib/store"

const BASE_STEPS = ["Password", "Two-Factor Auth", "Recovery Codes", "Relay", "Install App"] as const

function StepIndicator({ current, steps }: { current: number; steps: readonly string[] }) {
  return (
    <div className="relative flex items-center justify-between w-full max-w-md mx-auto py-2">
      {/* Background connector line */}
      <div className="absolute top-6 left-0 right-0 h-0.5 bg-border/40 -z-10" />
      {/* Progress connector line */}
      <div
        className="absolute top-6 left-0 h-0.5 bg-primary transition-all duration-500 -z-10"
        style={{ width: `${(current / (steps.length - 1)) * 100}%` }}
      />
      {steps.map((label, i) => (
        <div key={i} className="flex flex-col items-center relative z-10">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
              i < current
                ? "bg-primary text-primary-foreground scale-100"
                : i === current
                  ? "bg-background border-2 border-primary text-primary scale-110 shadow-md shadow-primary/10"
                  : "bg-background border border-border text-muted-foreground scale-100"
            }`}
          >
            {i < current ? <Check className="h-4.5 w-4.5" /> : i + 1}
          </div>
          <span
            className={`hidden sm:block text-[11px] font-medium mt-1.5 transition-colors duration-300 ${
              i === current ? "text-foreground font-semibold" : "text-muted-foreground"
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

function PasswordStrength({ password }: { password: string }) {
  let score = 0
  if (password.length >= 8) score += 0.25
  if (/[A-Z]/.test(password)) score += 0.25
  if (/[0-9]/.test(password)) score += 0.25
  if (/[^A-Za-z0-9]/.test(password)) score += 0.25

  const scorePct = password ? score * 100 : 0
  const color =
    scorePct < 30
      ? "bg-destructive"
      : scorePct < 60
        ? "bg-warning"
        : "bg-success"

  const label =
    scorePct === 0
      ? ""
      : scorePct < 30
        ? "Weak"
        : scorePct < 60
          ? "Medium"
          : "Strong"

  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-[11px] font-medium text-muted-foreground">
        <span>Password strength</span>
        <span className={scorePct < 30 ? "text-destructive" : scorePct < 60 ? "text-warning" : "text-success"}>
          {label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted shadow-inner">
        <div className={`h-full transition-all duration-300 ${color}`} style={{ width: `${scorePct}%` }} />
      </div>
    </div>
  )
}

function StepPassword({
  onComplete,
  onBack,
}: {
  onComplete: (token: string) => void
  onBack: () => void
}) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/setup/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (data.success) {
        sessionStorage.setItem("setup_token", data.token)
        onComplete(data.token)
      } else {
        setError(data.error || "Failed to set password")
      }
    } catch {
      setError("Connection error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="create-password" className="text-sm font-medium">Create Password</label>
        <div className="relative mt-1.5">
          <Input
            id="create-password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            className="pr-12 h-12 md:h-10 text-base md:text-sm"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-1 top-1/2 -translate-y-1/2 touch-target text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-5 w-5 md:h-4 md:w-4" /> : <Eye className="h-5 w-5 md:h-4 md:w-4" />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>
      <div>
        <label htmlFor="confirm-password" className="text-sm font-medium">Confirm Password</label>
        <div className="mt-1.5">
          <Input
            id="confirm-password"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            required
            minLength={8}
            className="h-12 md:h-10 text-base md:text-sm"
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive bg-destructive/10 p-2.5 rounded-xl border border-destructive/10 animate-fade-in">{error}</p>}
      
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" size="touch" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Button type="submit" size="touch" className="flex-1" disabled={loading || password.length < 8}>
          {loading ? "Setting up..." : "Continue"}
        </Button>
      </div>
    </form>
  )
}

function StepTotp({
  token,
  onComplete,
  onBack,
}: {
  token: string
  onComplete: (newToken: string) => void
  onBack: () => void
}) {
  const [qrSvg, setQrSvg] = useState("")
  const [secret, setSecret] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    async function fetchQr() {
      try {
        const res = await fetch(`/api/setup/totp?token=${token}`, { method: "POST" })
        const data = await res.json()
        if (data.success) {
          setQrSvg(data.qr_svg)
          setSecret(data.secret)
          setFetched(true)
        }
      } catch {
        setError("Failed to load QR code")
      }
    }
    fetchQr()
  }, [token])

  // Auto-submit TOTP code on 6 digits
  useEffect(() => {
    if (code.length === 6) {
      const e = { preventDefault: () => {} } as React.FormEvent
      handleSubmit(e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setError("")
    setLoading(true)
    try {
      const res = await fetch(`/api/setup/verify-totp?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (data.success) {
        sessionStorage.setItem("recovery_codes", JSON.stringify(data.codes))
        sessionStorage.setItem("setup_token", data.token)
        onComplete(data.token)
      } else {
        setError(data.error || "Invalid code")
        if (data.token) {
          sessionStorage.setItem("setup_token", data.token)
        }
      }
    } catch {
      setError("Connection error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Scan this QR code with an authenticator app (e.g. Google Authenticator, Authy), then enter the 6-digit code below.
      </p>
      {!fetched && !error && <p className="text-sm text-muted-foreground text-center py-6">Loading QR code...</p>}
      {error && !fetched && <p className="text-sm text-destructive text-center py-4 bg-destructive/10 rounded-xl border border-destructive/10">{error}</p>}
      
      {qrSvg && (
        <div className="flex justify-center p-3 rounded-2xl bg-white dark:bg-neutral-900 border border-border/40 shadow-inner max-w-[200px] mx-auto">
          <img src={qrSvg} alt="TOTP QR Code" className="h-44 w-44" />
        </div>
      )}
      {secret && (
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1.5">Or enter this key manually:</p>
          <code className="select-all rounded-lg bg-muted border border-border/45 px-3 py-1.5 text-xs font-mono tracking-wider">{secret}</code>
        </div>
      )}
      <div>
        <label htmlFor="totp-code" className="text-sm font-medium">TOTP Code</label>
        <div className="mt-1.5">
          <TotpInput value={code} onChange={setCode} id="totp-code" />
        </div>
      </div>
      {error && fetched && <p className="text-sm text-destructive bg-destructive/10 p-2.5 rounded-xl border border-destructive/10 animate-fade-in">{error}</p>}
      
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" size="touch" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Button type="submit" size="touch" className="flex-1" disabled={loading || code.length !== 6 || !fetched}>
          {loading ? "Verifying..." : "Verify & Continue"}
        </Button>
      </div>
    </form>
  )
}

function StepRecoveryCodes({
  onComplete,
  onBack,
}: {
  onComplete: (token: string) => void
  onBack: () => void
}) {
  const [codes, setCodes] = useState<string[]>(() => {
    try {
      const stored = sessionStorage.getItem("recovery_codes")
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const tokenRef = useRef(sessionStorage.getItem("setup_token"))

  useEffect(() => {
    if (codes.length === 0 && tokenRef.current) {
      fetch(`/api/setup/recovery-codes?token=${tokenRef.current}`, { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setCodes(data.codes)
            sessionStorage.setItem("recovery_codes", JSON.stringify(data.codes))
          }
        })
    }
  }, [codes.length])

  function handleCopy(code: string, i: number) {
    navigator.clipboard.writeText(code)
    setCopiedIndex(i)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  function handleDownload() {
    const text = codes.map((c, i) => `${i + 1}. ${c}`).join("\n")
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "sysdeck-recovery-codes.txt"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleConfirm() {
    if (!tokenRef.current || codes.length === 0) return
    try {
      const res = await fetch(`/api/setup/recovery-codes?token=${tokenRef.current}`, { method: "POST" })
      const data = await res.json()
      if (data.success && data.codes) {
        sessionStorage.setItem("recovery_codes", JSON.stringify(data.codes))
      }
    } catch {
      // proceed anyway
    }
    onComplete(tokenRef.current!)
  }

  if (codes.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">Loading recovery codes...</p>
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Save these recovery codes in a secure place. You can use them to access your account if you lose your authenticator device.
      </p>
      
      <div className="grid grid-cols-2 gap-2">
        {codes.map((code, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/40 pl-3 pr-1 py-1 min-h-[44px]">
            <code className="font-mono text-sm tracking-wider font-semibold">{code}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg shrink-0"
              onClick={() => handleCopy(code, i)}
              title="Copy code"
            >
              {copiedIndex === i ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        ))}
      </div>
      
      <div className="flex justify-start">
        <Button variant="outline" size="sm" onClick={handleDownload} className="rounded-xl border-border/40">
          <Download className="mr-1.5 h-4 w-4" />
          Download Backup File
        </Button>
      </div>
      
      <Separator className="bg-border/50" />
      
      <div className="flex items-start gap-3 bg-muted/20 p-3.5 rounded-xl border border-border/40">
        <Switch
          id="confirm-codes"
          checked={confirmed}
          onChange={setConfirmed}
          className="mt-0.5"
        />
        <label htmlFor="confirm-codes" className="text-xs text-muted-foreground cursor-pointer leading-normal">
          I have written down or saved my recovery codes in a secure location
        </label>
      </div>
      
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" size="touch" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Button size="touch" className="flex-1" disabled={!confirmed} onClick={handleConfirm}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function StepRelay({
  onComplete,
  onBack,
}: {
  onComplete: (enabled: boolean) => void
  onBack: () => void
}) {
  const [enabled, setEnabled] = useState(false)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Optionally expose this agent to the internet via a Cloudflare Quick Tunnel.
        This allows remote access from outside your local network without port forwarding.
      </p>
      
      <div className="flex items-start gap-3 rounded-2xl bg-warning/10 p-4 text-xs text-warning-foreground border border-warning/15">
        <span>
          <strong>*Note:</strong> Because this uses a free, zero-signup tunnel, your remote URL will change every time the app restarts. We are working on adding persistent domain support soon!
        </span>
      </div>
      
      <div className="flex items-center gap-3 bg-muted/30 p-4 rounded-xl border border-border/30">
        <Switch
          id="relay-enable"
          checked={enabled}
          onChange={setEnabled}
        />
        <label htmlFor="relay-enable" className="text-sm font-medium text-foreground cursor-pointer">
          Enable Cloudflare Relay
        </label>
      </div>
      
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" size="touch" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Button size="touch" className="flex-1" onClick={() => onComplete(enabled)}>
          Complete Setup
        </Button>
      </div>
    </div>
  )
}

function StepPwa({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 glow-teal">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Install App on Phone</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            For the best experience, install SysDeck as an app on your mobile home screen.
          </p>
        </div>

        <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold mt-0.5">1</div>
            <div>
              <p className="font-semibold text-sm">Open in Browser</p>
              <p className="text-xs text-muted-foreground mt-0.5">Open the Cloudflare URL or Local IP shown in the terminal on your mobile device.</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold mt-0.5">2</div>
            <div>
              <p className="font-semibold text-sm">Tap Share / Options</p>
              <p className="text-xs text-muted-foreground mt-0.5">On iOS: Tap the standard Share button at the bottom.</p>
              <p className="text-xs text-muted-foreground mt-0.5">On Android: Tap browser Menu icon (three dots).</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold mt-0.5">3</div>
            <div>
              <p className="font-semibold text-sm">Add to Home Screen</p>
              <p className="text-xs text-muted-foreground mt-0.5">This removes the browser URL bar, provides full-screen standalone windows, and locks wake lock features.</p>
            </div>
          </div>
        </div>
      </div>

      <Button onClick={onComplete} size="touch" className="w-full font-semibold shadow-md">
        Done, Take Me to Login →
      </Button>
    </div>
  )
}

function StepWelcome({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-start gap-3.5 bg-muted/20 p-4 rounded-xl border border-border/30">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold mt-0.5">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-sm">Secure your account</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Create an admin password and configure Two-Factor Authentication (2FA) to encrypt remote requests.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3.5 bg-muted/20 p-4 rounded-xl border border-border/30">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold mt-0.5">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-sm">Enable Remote Access</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Expose this PC via Cloudflare Tunnel securely so you can control it on the go.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3.5 bg-muted/20 p-4 rounded-xl border border-border/30">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold mt-0.5">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-sm">Manage Everything</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Once setup finishes, browse files, execute scripts, and view your remote desktop.
            </p>
          </div>
        </div>
      </div>

      <Button onClick={onComplete} size="touch" className="w-full mt-4 font-semibold shadow-md">
        Start Setup →
      </Button>
    </div>
  )
}

export function SetupPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/setup/status")
        const data = await res.json()
        if (data.is_setup_complete) {
          navigate("/login", { replace: true })
          return
        }
        const savedToken = sessionStorage.getItem("setup_token")
        if (savedToken) {
          const progressRes = await fetch(`/api/setup/progress?token=${savedToken}`)
          const progressData = await progressRes.json()
          if (progressData.success) {
            setToken(savedToken)
            setStep(progressData.current_step)
          }
        }
      } catch {
        // continue to setup
      } finally {
        setChecking(false)
      }
    }
    checkStatus()
  }, [navigate])

  const handlePasswordComplete = useCallback((newToken: string) => {
    setToken(newToken)
    setStep(2)
  }, [])

  const handleTotpComplete = useCallback((newToken: string) => {
    setToken(newToken)
    setStep(3)
  }, [])

  const handleRecoveryComplete = useCallback((newToken: string) => {
    setToken(newToken)
    setStep(4)
  }, [])

  const handleRelayComplete = useCallback((enabled: boolean) => {
    const token = sessionStorage.getItem("setup_token")
    if (!token) return
    fetch(`/api/setup/relay?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then(async (res) => {
      const data = await res.json()
      if (data.success && data.token) {
        await fetch(`/api/setup/finish?token=${data.token}`, { method: "POST" })
      }
    }).catch(() => {}).finally(() => {
      setStep(5)
    })
  }, [])

  const handlePwaComplete = useCallback(() => {
    sessionStorage.removeItem("setup_token")
    sessionStorage.removeItem("recovery_codes")
    useAuthStore.getState().setSetupComplete(true)
    navigate("/login", { replace: true })
  }, [navigate])

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep(step - 1)
    }
  }, [step])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), var(--background)" }}>
        <p className="text-sm text-muted-foreground animate-pulse">Checking setup status...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden animate-fade-in"
      style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 50%, hsl(210 80% 50% / 0.05) 0%, transparent 50%), var(--background)" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/5 blur-3xl animate-breathe" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-chart-2/5 blur-3xl animate-breathe" style={{ animationDelay: "-3s" }} />
      </div>
      <div className="w-full max-w-lg space-y-6 relative animate-fade-in-up">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">SysDeck Agent Setup</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure your agent security & remote options</p>
        </div>
        
        {step > 0 && <StepIndicator current={step - 1} steps={BASE_STEPS} />}
        
        <Card variant="glass" className="shadow-lg relative overflow-hidden">
          <CardHeader>
            <CardTitle>
              {step === 0 ? "Welcome to SysDeck" : BASE_STEPS[step - 1]}
            </CardTitle>
            <CardDescription>
              {step === 0 ? "Let's get your remote access set up in 4 quick steps." :
               step === 1 ? "Create a strong password to secure your agent" :
               step === 2 ? "Set up two-factor authentication" :
               step === 3 ? "Store your recovery codes safely" :
               step === 4 ? "Configure remote access options" :
               "Install SysDeck as an app on your phone"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 0 ? (
              <StepWelcome onComplete={() => setStep(1)} />
            ) : step === 1 ? (
              <StepPassword onComplete={handlePasswordComplete} onBack={handleBack} />
            ) : step === 2 && token ? (
              <StepTotp token={token} onComplete={handleTotpComplete} onBack={handleBack} />
            ) : step === 3 ? (
              <StepRecoveryCodes onComplete={handleRecoveryComplete} onBack={handleBack} />
            ) : step === 4 ? (
              <StepRelay onComplete={handleRelayComplete} onBack={handleBack} />
            ) : step === 5 ? (
              <StepPwa onComplete={handlePwaComplete} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
