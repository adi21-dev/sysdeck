import { useState, useEffect, useCallback, useRef } from "react"
import { Power, RefreshCw, Moon, LogOut, AlertTriangle, PowerOff, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
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
      if (data.success) {
        startPolling()
      } else {
        setError(data.message || "Command failed")
      }
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

  const cards = [
    { action: "shutdown", label: "Shutdown", icon: Power, color: "text-red-500", bg: "bg-red-500/10" },
    { action: "restart", label: "Restart", icon: RefreshCw, color: "text-amber-500", bg: "bg-amber-500/10" },
    { action: "sleep", label: "Sleep", icon: Moon, color: "text-blue-500", bg: "bg-blue-500/10" },
    { action: "hibernate", label: "Hibernate", icon: PowerOff, color: "text-purple-500", bg: "bg-purple-500/10" },
    { action: "signout", label: "Sign Out", icon: LogOut, color: "text-orange-500", bg: "bg-orange-500/10" },
    { action: "lock", label: "Lock", icon: Lock, color: "text-gray-500", bg: "bg-gray-500/10" },
  ]

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-bold">Power Controls</h1>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {pendingAction && (
        <div className="flex items-center justify-between rounded-md bg-accent p-4">
          <div>
            <p className="font-medium">{pendingAction.action} in progress</p>
            <p className="text-sm text-muted-foreground">
              {pendingAction.remaining}s remaining
            </p>
          </div>
          <Button variant="destructive" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <Card
            key={card.action}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => !pendingAction && handlePowerAction(card.action)}
          >
            <CardHeader className={cn("flex items-center justify-center py-8", card.bg)}>
              <card.icon className={cn("h-12 w-12", card.color)} />
            </CardHeader>
            <CardContent className="text-center py-4">
              <CardTitle className="text-lg">{card.label}</CardTitle>
              {pendingAction && (
                <p className="text-xs text-muted-foreground mt-1">Disabled — action pending</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog open={confirmDialog != null} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Active file transfer in progress</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.transfers} file transfer(s) are in progress.
              {confirmDialog?.action === "shutdown" ? " Shutdown" : 
               confirmDialog?.action === "restart" ? " Restart" : 
               confirmDialog?.action === "sleep" ? " Sleep" :
               confirmDialog?.action === "hibernate" ? " Hibernate" : " Sign Out"}
              {" "}will cancel them. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmed} className="bg-destructive hover:bg-destructive/90">
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}


