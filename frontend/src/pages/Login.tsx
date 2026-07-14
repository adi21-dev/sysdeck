import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Monitor, AlertTriangle, Eye, EyeOff, Copy, Check } from "lucide-react"
import { useAuthStore } from "@/lib/store"
import { TotpInput } from "@/components/ui/totp-input"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function LoginPage() {
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [totp, setTotp] = useState("")
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(true)
  const navigate = useNavigate()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [dataDir, setDataDir] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  useEffect(() => {
    fetch("/api/system/data-dir")
      .then((r) => r.json())
      .then((d) => { if (d.path) setDataDir(d.path) })
      .catch(() => {})
  }, [])

  if (checking) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setIsSubmitting(true)
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
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCopyPath() {
    if (!dataDir) return
    try {
      await navigator.clipboard.writeText(dataDir)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
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
        <div className="relative rounded-2xl border border-border/50 bg-card backdrop-blur-2xl saturate-[1.6] p-8 shadow-lg overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent pointer-events-none dark:from-white/5" />
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
              <label htmlFor="login-totp-0" className="block text-sm font-medium mb-2">Authentication Code</label>
              <TotpInput value={totp} onChange={setTotp} id="login-totp-0" />
            </div>
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 backdrop-blur-sm text-destructive text-sm border border-destructive/10">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={isSubmitting} className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 active:scale-[0.98] transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {isSubmitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setShowReset(true)}
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors underline underline-offset-2"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={showReset} onOpenChange={setShowReset}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>How to reset your password</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>Follow these steps to delete all data and start fresh:</p>
              <ol className="list-decimal list-inside space-y-2 text-sm text-left">
                <li>Close SysDeck from the system tray (bottom right icon).</li>
                <li>
                  Delete the following folder:
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-2 py-1 text-xs break-all font-mono">
                      {dataDir ?? "Loading..."}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0 h-8 w-8"
                      onClick={handleCopyPath}
                      title="Copy path"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </li>
                <li>Restart SysDeck. You will be prompted to set up a new password.</li>
              </ol>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setShowReset(false)}>Got it</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
