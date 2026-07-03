import { useState, useRef, useEffect, type KeyboardEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Monitor, AlertTriangle } from "lucide-react"
import { useAuthStore } from "@/lib/store"

export function LoginPage() {
  const [password, setPassword] = useState("")
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border bg-card p-8 shadow-lg">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 mb-4">
              <Monitor className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to NodeDesk</h1>
            <p className="text-sm text-muted-foreground mt-2">Sign in to manage your remote system</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium mb-2">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
                placeholder="Enter your password"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Authentication Code</label>
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
                    className="w-12 h-12 text-center text-xl font-semibold rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    required
                  />
                ))}
              </div>
            </div>
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" className="w-full py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity">
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
