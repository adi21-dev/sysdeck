import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Monitor, AlertTriangle, Eye, EyeOff, Copy, Check, Loader2, X } from "lucide-react"
import { useAuthStore } from "@/lib/store"
import { TotpInput } from "@/components/ui/totp-input"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

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

  // Auto-submit TOTP when 6 digits are entered
  useEffect(() => {
    if (totp.length === 6 && password) {
      const e = { preventDefault: () => {} } as React.FormEvent
      handleSubmit(e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totp])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setError("")
    setIsSubmitting(true)
    // Mobile haptic feedback on sign in click
    if (navigator.vibrate) navigator.vibrate(10)
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

  if (checking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4"
        style={{ background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), var(--background)" }}>
        <div className="text-center animate-pulse">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, hsl(173 80% 30% / 0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 50%, hsl(210 80% 50% / 0.05) 0%, transparent 50%), var(--background)"
      }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/5 blur-3xl animate-breathe" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-chart-2/5 blur-3xl animate-breathe" style={{ animationDelay: "-3s" }} />
      </div>
      
      <div className="w-full max-w-md relative animate-fade-in-up">
        <Card variant="glass-shine" className="p-8 shadow-xl overflow-hidden">
          <div className="text-center mb-8 relative z-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-5 glow-teal">
              <Monitor className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome to SysDeck</h1>
            <p className="text-sm text-muted-foreground mt-2">Sign in to manage your remote system</p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium mb-2">Password</label>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12 text-base md:text-sm h-12 md:h-10"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 touch-target text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5 md:h-4 md:w-4" /> : <Eye className="h-5 w-5 md:h-4 md:w-4" />}
                </button>
              </div>
            </div>
            
            <div>
              <label htmlFor="login-totp-0" className="block text-sm font-medium mb-2">Authentication Code</label>
              <TotpInput value={totp} onChange={setTotp} id="login-totp-0" />
            </div>
            
            {error && (
              <div className="flex items-start gap-2 p-3.5 rounded-xl bg-destructive/10 backdrop-blur-sm text-destructive text-sm border border-destructive/10 animate-fade-in">
                <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button 
                  type="button" 
                  onClick={() => setError("")} 
                  className="text-destructive/60 hover:text-destructive p-0.5 rounded"
                  aria-label="Dismiss error"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            
            <Button
              type="submit"
              disabled={isSubmitting}
              size="touch"
              className="w-full shadow-md hover:shadow-lg font-semibold"
            >
              {isSubmitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          
          <div className="mt-6 text-center relative z-10">
            <button
              type="button"
              onClick={() => setShowReset(true)}
              className="text-xs md:text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors underline underline-offset-4 touch-target inline-flex items-center justify-center py-2"
            >
              Forgot password?
            </button>
          </div>
        </Card>
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
