import { useState, useEffect, useCallback, useRef } from "react"
import { Power, RefreshCw, Moon, Bed, LogOut, Lock, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface PowerResponse {
  success: boolean
  message: string
  active_transfers?: number
}

interface PowerStatus {
  has_pending: boolean
  action: string | null
  remaining_secs: number | null
}

async function powerAction(action: string, confirmed: boolean): Promise<PowerResponse> {
  const res = await fetch("/api/power/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, confirmed }),
  })
  return res.json()
}

async function cancelPower(): Promise<PowerResponse> {
  const res = await fetch("/api/power/cancel", { method: "POST" })
  return res.json()
}

async function powerStatus(): Promise<PowerStatus> {
  const res = await fetch("/api/power/status")
  return res.json()
}

const cards = [
  { action: "shutdown", label: "Shutdown", desc: "Power off the system completely", icon: Power, destructive: true },
  { action: "restart", label: "Restart", desc: "Reboot the system", icon: RefreshCw, destructive: false },
  { action: "sleep", label: "Sleep", desc: "Put system in low-power state", icon: Moon, destructive: false },
  { action: "hibernate", label: "Hibernate", desc: "Save state and power off", icon: Bed, destructive: false },
  { action: "signout", label: "Sign Out", desc: "Log out of current session", icon: LogOut, destructive: false },
  { action: "lock", label: "Lock", desc: "Lock the workstation", icon: Lock, destructive: false },
]

export function ControlsPage() {
  const [pendingAction, setPendingAction] = useState<{ action: string; remaining: number } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; transfers: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const status = await powerStatus()
        if (status.has_pending && status.action && status.remaining_secs != null) {
          setPendingAction({ action: status.action, remaining: status.remaining_secs })
        } else {
          setPendingAction(null)
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch {
        setError("Unable to reach server")
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
      }
    }, 1000)
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handlePowerAction = async (action: string) => {
    setError(null)
    try {
      const data = await powerAction(action, false)
      if (data.active_transfers && data.active_transfers > 0) {
        setConfirmDialog({ action, transfers: data.active_transfers })
      } else if (data.success) {
        startPolling()
      } else {
        setError(data.message || "Command failed")
      }
    } catch {
      setError("Network error")
    }
  }

  const handleConfirmed = async () => {
    if (!confirmDialog) return
    const action = confirmDialog.action
    setConfirmDialog(null)
    try {
      const data = await powerAction(action, true)
      if (data.success) startPolling()
      else setError(data.message || "Command failed")
    } catch {
      setError("Network error")
    }
  }

  const handleCancel = async () => {
    try {
      await cancelPower()
      setPendingAction(null)
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    } catch {
      setError("Failed to cancel")
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {pendingAction && (
        <div className="flex items-center justify-between rounded-md border bg-card p-4">
          <div>
            <p className="font-medium capitalize">{pendingAction.action} in progress</p>
            <p className="text-sm text-muted-foreground">{pendingAction.remaining}s remaining</p>
          </div>
          <Button variant="destructive" onClick={handleCancel}>Cancel</Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <button
            key={card.action}
            onClick={() => !pendingAction && handlePowerAction(card.action)}
            className={cn(
              "rounded-xl border bg-card p-6 text-left transition-colors hover:bg-accent/50 group",
              card.destructive && "hover:border-destructive/50",
              !card.destructive && "hover:border-primary/50",
              pendingAction && "opacity-50 cursor-not-allowed"
            )}
          >
            <div className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-colors",
              card.destructive ? "bg-destructive/10 group-hover:bg-destructive/20" : "bg-primary/10 group-hover:bg-primary/20"
            )}>
              <card.icon className={cn("w-6 h-6", card.destructive ? "text-destructive" : "text-primary")} />
            </div>
            <h3 className="font-semibold mb-1">{card.label}</h3>
            <p className="text-sm text-muted-foreground">{card.desc}</p>
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={() => setConfirmDialog(null)}
        title="Active file transfer in progress"
        description={`${confirmDialog?.transfers} file transfer(s) are in progress. ${confirmDialog?.action === "shutdown" ? "Shutdown" : confirmDialog?.action === "restart" ? "Restart" : confirmDialog?.action === "sleep" ? "Sleep" : confirmDialog?.action === "hibernate" ? "Hibernate" : "Sign Out"} will cancel them.`}
        confirmText={confirmDialog?.action?.toUpperCase() ?? "CONFIRM"}
        actionLabel="Execute"
        onConfirm={handleConfirmed}
      />
    </div>
  )
}
