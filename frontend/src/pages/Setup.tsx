import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Check, Copy, Download, Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { TotpInput } from "@/components/ui/totp-input"
import { useAuthStore } from "@/lib/store"

const BASE_STEPS = ["Password", "Two-Factor Auth", "Recovery Codes", "Relay", "Install App"] as const

function StepIndicator({ current, steps }: { current: number; steps: readonly string[] }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              i < current
                ? "bg-primary text-primary-foreground"
                : i === current
                  ? "border-2 border-primary text-primary"
                  : "border border-muted-foreground/30 text-muted-foreground"
            }`}
          >
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          <span
            className={`hidden text-sm sm:inline ${i === current ? "font-medium text-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </span>
          {i < steps.length - 1 && <div className="mx-1 h-px w-8 bg-border sm:mx-2 sm:w-12" />}
        </div>
      ))}
    </div>
  )
}

function PasswordStrength({ password }: { password: string }) {
  const score = Math.min(password.length / 12, 1)
  const color =
    score < 0.3 ? "bg-destructive" : score < 0.6 ? "bg-yellow-500" : score < 0.8 ? "bg-yellow-400" : "bg-green-500"
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full transition-all ${color}`} style={{ width: `${score * 100}%` }} />
    </div>
  )
}

function StepPassword({
  onComplete,
}: {
  onComplete: (token: string) => void
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
        <div className="relative">
          <Input
            id="create-password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>
      <div>
        <label htmlFor="confirm-password" className="text-sm font-medium">Confirm Password</label>
        <Input
          id="confirm-password"
          type={show ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat your password"
          required
          minLength={8}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading || password.length < 8}>
        {loading ? "Setting up..." : "Continue"}
      </Button>
    </form>
  )
}

function StepTotp({
  token,
  onComplete,
}: {
  token: string
  onComplete: (newToken: string) => void
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
      <p className="text-sm text-muted-foreground">
        Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy), then enter the 6-digit code below.
      </p>
      {!fetched && !error && <p className="text-sm text-muted-foreground">Loading QR code...</p>}
      {error && !fetched && <p className="text-sm text-destructive">{error}</p>}
      {qrSvg && (
        <div className="flex justify-center">
          <img src={qrSvg} alt="TOTP QR Code" className="h-48 w-48" />
        </div>
      )}
      {secret && (
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
          <code className="select-all rounded bg-muted px-2 py-1 text-xs font-mono">{secret}</code>
        </div>
      )}
      <div>
        <label htmlFor="totp-code" className="text-sm font-medium">TOTP Code</label>
        <TotpInput value={code} onChange={setCode} id="totp-code" />
      </div>
      {error && fetched && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading || code.length !== 6 || !fetched}>
        {loading ? "Verifying..." : "Verify & Continue"}
      </Button>
    </form>
  )
}

function StepRecoveryCodes({ onComplete }: { onComplete: (token: string) => void }) {
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
    return <p className="text-sm text-muted-foreground">Loading recovery codes...</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Save these recovery codes in a secure place. You can use them to access your account if you lose your authenticator device.
      </p>
      <div className="space-y-1.5">
        {codes.map((code, i) => (
          <div key={i} className="flex items-center justify-between rounded border bg-muted/50 px-3 py-2">
            <code className="font-mono text-sm tracking-wider">{code}</code>
            <button
              type="button"
              onClick={() => handleCopy(code, i)}
              className="text-muted-foreground hover:text-foreground"
              title="Copy code"
            >
              {copiedIndex === i ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-1 h-4 w-4" />
          Download
        </Button>
      </div>
      <Separator />
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id="confirm-codes"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <label htmlFor="confirm-codes" className="text-sm text-muted-foreground cursor-pointer">
          I have saved my recovery codes in a secure location
        </label>
      </div>
      <Button className="w-full" disabled={!confirmed} onClick={handleConfirm}>
        Continue
      </Button>
    </div>
  )
}

function StepRelay({ onComplete }: { onComplete: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(false)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optionally expose this agent to the internet via a Cloudflare Quick Tunnel.
        This allows remote access from outside your local network without port forwarding.
      </p>
      <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
        <span>
          <strong>*Note:</strong> Because this uses a free, zero-signup tunnel, your remote URL will change every time the app restarts. We are working on adding persistent domain support soon!
        </span>
      </div>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id="relay-enable"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1"
        />
        <label htmlFor="relay-enable" className="text-sm text-muted-foreground cursor-pointer">
          Enable Cloudflare Relay
        </label>
      </div>
      <Button className="w-full" onClick={() => onComplete(enabled)}>
        Complete Setup
      </Button>
    </div>
  )
}

function StepPwa({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Add to Home Screen</h3>
          <p className="text-sm text-muted-foreground mt-1">
            For the best experience, install SysDeck as an app on your phone.
          </p>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium mt-0.5">1</div>
            <div>
              <p className="font-medium text-sm">Open in Safari / Chrome</p>
              <p className="text-xs text-muted-foreground mt-0.5">Navigate to the IP or Cloudflare URL shown in the terminal.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium mt-0.5">2</div>
            <div>
              <p className="font-medium text-sm">Tap Share</p>
              <p className="text-xs text-muted-foreground mt-0.5">On iPhone: Share button at the bottom of the browser.</p>
              <p className="text-xs text-muted-foreground mt-0.5">On Android: Menu → Add to Home Screen.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium mt-0.5">3</div>
            <div>
              <p className="font-medium text-sm">Add to Home Screen</p>
              <p className="text-xs text-muted-foreground mt-0.5">You'll get a standalone window, no URL bar, and wake lock support.</p>
            </div>
          </div>
        </div>
      </div>

      <Button onClick={onComplete} className="w-full">
        Done, Take Me to Login →
      </Button>
    </div>
  )
}

function StepWelcome({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium mt-0.5">
            1
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Secure your account</h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              You will create an admin password and set up Two-Factor Authentication (2FA) to keep your system safe.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium mt-0.5">
            2
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Enable Remote Access (Optional)</h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              You can turn on the Cloudflare Relay to access this PC from anywhere in the world.
              <br />
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1 block">
                *Note: Because this uses a free, zero-signup tunnel, your remote URL will change every time the app restarts. We are working on adding persistent domain support soon!
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium mt-0.5">
            3
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Access your dashboard</h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              Once setup is complete, you'll be able to manage your files, terminal, and system hardware directly from your browser.
            </p>
          </div>
        </div>
      </div>

      <Button onClick={onComplete} className="w-full mt-4">
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

  const handleRecoveryComplete = useCallback(() => {
    setStep(4)
  }, [])

  const handlePwaComplete = useCallback(() => {
    sessionStorage.removeItem("setup_token")
    sessionStorage.removeItem("recovery_codes")
    useAuthStore.getState().setSetupComplete(true)
    navigate("/login", { replace: true })
  }, [navigate])

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

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), var(--background)" }}>
        <p className="text-muted-foreground">Checking setup status...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 50%, hsl(210 80% 50% / 0.05) 0%, transparent 50%), var(--background)" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/5 blur-3xl animate-float" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-chart-2/5 blur-3xl animate-float" style={{ animationDelay: "-3s" }} />
      </div>
      <div className="w-full max-w-lg space-y-6 relative">
        <div className="text-center">
          <h1 className="text-2xl font-bold">SysDeck Agent Setup</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure your agent</p>
        </div>
        {step > 0 && <StepIndicator current={step - 1} steps={BASE_STEPS} />}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <CardHeader>
            <CardTitle>
              {step === 0 ? "Welcome to SysDeck" : BASE_STEPS[step - 1]}
            </CardTitle>
            <CardDescription>
              {step === 0 ? "Let's get your remote access set up in 3 quick steps." :
               step === 1 ? "Create a strong password to secure your agent" :
               step === 2 ? "Set up two-factor authentication" :
               step === 3 ? "Store your recovery codes safely" :
               step === 4 ? "Configure remote access" :
               "Install SysDeck as an app on your phone"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 0 ? (
              <StepWelcome onComplete={() => setStep(1)} />
            ) : step === 1 ? (
              <StepPassword onComplete={handlePasswordComplete} />
            ) : step === 2 && token ? (
              <StepTotp token={token} onComplete={handleTotpComplete} />
            ) : step === 3 ? (
              <StepRecoveryCodes onComplete={handleRecoveryComplete} />
            ) : step === 4 ? (
              <StepRelay onComplete={handleRelayComplete} />
            ) : step === 5 ? (
              <StepPwa onComplete={handlePwaComplete} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
