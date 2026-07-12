import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Monitor, AlertTriangle, Eye, EyeOff } from "lucide-react"
import { useAuthStore } from "@/lib/store"

export function LoginPage() {
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [totp, setTotp] = useState(["", "", "", "", "", ""])
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(true)
  const navigate = useNavigate()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const inputsRef = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          setAuthenticated(true)
          navigate("/dashboard", { replace: true })
        }
        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [navigate, setAuthenticated])

  if (checking) return null

  const handleTotpChange = (index: number, value: string) => {
    if (value.length > 1) return
    const next = [...totp]
    next[index] = value
    setTotp(next)
    if (value && index < 5) {
      inputsRef.current[index + 1]?.focus()
    }
  }

  const handleTotpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !totp[index] && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password, totp_code: totp.join("") }),
      })
      const data = await res.json()
      if (data.success) {
        setAuthenticated(true)
        navigate("/dashboard")
      } else if (res.status === 429) {
        setError("Too many attempts. Try again later.")
      } else {
        setError(data.message || "Login failed")
      }
    } catch {
      setError("Connection error")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 50%, hsl(210 80% 50% / 0.05) 0%, transparent 50%), var(--background)"
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/5 blur-3xl animate-float" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-chart-2/5 blur-3xl animate-float" style={{ animationDelay: "-3s" }} />
      </div>
      <div className="w-full max-w-md relative">
        <div className="rounded-2xl border border-border/50 bg-card backdrop-blur-2xl p-8 shadow-lg">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-5 glow-teal">
              <Monitor className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome to SysDeck</h1>
            <p className="text-sm text-muted-foreground mt-2">Sign in to manage your remote system</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium mb-2">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all pr-10"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <span className="block text-sm font-medium mb-2">Authentication Code</span>
              <div className="flex gap-2 justify-center">
                {totp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputsRef.current[i] = el }}
                    type="text"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleTotpChange(i, e.target.value)}
                    onKeyDown={(e) => handleTotpKeyDown(i, e)}
                    className="w-11 h-12 text-center text-lg font-bold rounded-xl border border-input bg-background/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary/50 transition-all"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    required
                  />
                ))}
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 backdrop-blur-sm text-destructive text-sm border border-destructive/10">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 active:scale-[0.98] transition-all duration-200 shadow-sm">
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
