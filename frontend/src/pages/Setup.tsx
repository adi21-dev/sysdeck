import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Check, Copy, Download, Eye, EyeOff, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { useAuthStore } from "@/lib/store"

const BASE_STEPS = ["Password", "Two-Factor Auth", "Recovery Codes", "Relay"] as const

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
        <Input
          id="totp-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          required
          maxLength={6}
        />
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
    a.download = "nodedesk-recovery-codes.txt"
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

function StepToken({ onComplete }: { onComplete: () => void }) {
  const [inputToken, setInputToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/setup/verify-setup-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inputToken }),
      })
      const data = await res.json()
      if (data.success) {
        onComplete()
      } else {
        setError("Invalid setup token. Check the server console for the token.")
      }
    } catch {
      setError("Connection error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>This server requires a setup token. Enter the token printed in the server console.</span>
      </div>
      <div>
        <label htmlFor="setup-token" className="text-sm font-medium">Setup Token</label>
        <Input
          id="setup-token"
          type="text"
          value={inputToken}
          onChange={(e) => setInputToken(e.target.value)}
          placeholder="Enter setup token"
          required
          autoComplete="off"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading || !inputToken}>
        {loading ? "Verifying..." : "Verify & Continue"}
      </Button>
    </form>
  )
}

export function SetupPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [tokenRequired, setTokenRequired] = useState(false)
  const [offset, setOffset] = useState(0)

  const steps = tokenRequired ? ["Token", ...BASE_STEPS] : BASE_STEPS

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/setup/status")
        const data = await res.json()
        if (data.is_setup_complete) {
          navigate("/login", { replace: true })
          return
        }
        const tokenRes = await fetch("/api/setup/check-token")
        const tokenData = await tokenRes.json()
        if (tokenData.token_required) {
          setTokenRequired(true)
          setOffset(1)
        }
        const savedToken = sessionStorage.getItem("setup_token")
        if (savedToken) {
          const progressRes = await fetch(`/api/setup/progress?token=${savedToken}`)
          const progressData = await progressRes.json()
          if (progressData.success) {
            setToken(savedToken)
            setStep(progressData.current_step - 1 + (tokenData.token_required ? 1 : 0))
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

  const handleTokenComplete = useCallback(() => {
    setStep(1)
  }, [])

  const handlePasswordComplete = useCallback((newToken: string) => {
    setToken(newToken)
    setStep(1 + offset)
  }, [offset])

  const handleTotpComplete = useCallback((newToken: string) => {
    setToken(newToken)
    setStep(2 + offset)
  }, [offset])

  const handleRecoveryComplete = useCallback(() => {
    setStep(3 + offset)
  }, [offset])

  const handleRelayComplete = useCallback(async (enabled: boolean) => {
    const token = sessionStorage.getItem("setup_token")
    if (!token) return
    try {
      const res = await fetch(`/api/setup/relay?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json()
      if (data.success && data.token) {
        await fetch(`/api/setup/finish?token=${data.token}`, { method: "POST" }).catch(() => {})
      }
    } catch {
      // proceed anyway
    }
    sessionStorage.removeItem("setup_token")
    sessionStorage.removeItem("recovery_codes")
    useAuthStore.getState().setSetupComplete(true)
    navigate("/login", { replace: true })
  }, [navigate])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Checking setup status...</p>
      </div>
    )
  }

  const baseStep = step - offset

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">NodeDesk Agent Setup</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure your agent</p>
        </div>
        <StepIndicator current={step} steps={steps} />
        <Card>
          <CardHeader>
            <CardTitle>{steps[step]}</CardTitle>
            <CardDescription>
              {steps[step] === "Token" ? "Enter the setup token from the server console" :
               steps[step] === "Password" ? "Create a strong password to secure your agent" :
               steps[step] === "Two-Factor Auth" ? "Set up two-factor authentication" :
               steps[step] === "Recovery Codes" ? "Store your recovery codes safely" :
               "Configure remote access"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 0 && tokenRequired ? (
              <StepToken onComplete={handleTokenComplete} />
            ) : baseStep === 0 ? (
              <StepPassword onComplete={handlePasswordComplete} />
            ) : baseStep === 1 && token ? (
              <StepTotp token={token} onComplete={handleTotpComplete} />
            ) : baseStep === 2 ? (
              <StepRecoveryCodes onComplete={handleRecoveryComplete} />
            ) : baseStep === 3 ? (
              <StepRelay onComplete={handleRelayComplete} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
