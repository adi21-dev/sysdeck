import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/lib/store"

export function LoginPage() {
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [totp, setTotp] = useState("")
  const [error, setError] = useState("")
  const navigate = useNavigate()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password, totp_code: totp }),
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">NodeDesk Agent</h1>
          <p className="text-muted-foreground mt-1 text-sm">Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-password" className="text-sm font-medium">Password</label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pr-10"
                aria-label="Password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="login-totp" className="text-sm font-medium">TOTP Code</label>
            <Input
              id="login-totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder="000000"
              required
              aria-label="TOTP code"
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="w-full">Sign In</Button>
        </form>
      </div>
    </div>
  )
}
