import { useState, useEffect, useRef } from "react"
import {
  Power,
  RefreshCw,
  Moon,
  Bed,
  LogOut,
  Lock,
  Wifi,
  WifiOff,
  Sun,
  Volume2,
  VolumeX,
  Volume1,
  Bell,
  BellOff,
  SkipBack,
  SkipForward,
  Monitor,
  Loader2,
  Sliders,
  Play,
  ChevronDown
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useHardwareStore, useToastStore } from "@/lib/store"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoButton } from "@/components/ui/info-button"

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

async function schedulePower(
  action: string,
  delayMins: number,
  force: boolean,
  confirmed: boolean
): Promise<PowerResponse> {
  const res = await fetch("/api/power/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, delay_mins: delayMins, force, confirmed }),
  })
  return res.json()
}

const cards = [
  { action: "shutdown", label: "Shutdown", desc: "Power off completely", icon: Power, destructive: true },
  { action: "restart", label: "Restart", desc: "Reboot system", icon: RefreshCw, destructive: false },
  { action: "sleep", label: "Sleep", desc: "Low-power standby", icon: Moon, destructive: false },
  { action: "hibernate", label: "Hibernate", desc: "Save & power off", icon: Bed, destructive: false },
  { action: "signout", label: "Sign Out", desc: "Log out user", icon: LogOut, destructive: false },
  { action: "lock", label: "Lock", desc: "Lock workstation", icon: Lock, destructive: false },
]

function haptic() {
  if (navigator.vibrate) navigator.vibrate(10)
}

export function ControlsPage() {
  const toastStore = useToastStore()
  const {
    audio,
    display,
    toggles,
    fetchAll,
    setVolume,
    setMuted,
    setDevice,
    triggerMedia,
    setBrightness,
    toggleControlCenter,
  } = useHardwareStore()

  const [pendingAction, setPendingAction] = useState<{ action: string; remaining: number } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; type: "immediate" | "scheduled"; delay?: number; force?: boolean; transfers: number } | null>(null)
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [scheduleTime, setScheduleTime] = useState("10")
  const [scheduleAction, setScheduleAction] = useState("shutdown")
  const [scheduleForce, setScheduleForce] = useState(false)
  const [powerLoading, setPowerLoading] = useState(false)

  const [localVolume, setLocalVolume] = useState(50)
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const [localBrightness, setLocalBrightness] = useState(50)
  const [isDraggingBrightness, setIsDraggingBrightness] = useState(false)
  const skipPollUntilRef = useRef<number>(0)

  useEffect(() => {
    if (audio && !isDraggingVolume && Date.now() > skipPollUntilRef.current) {
      setLocalVolume(audio.volume)
    }
  }, [audio, isDraggingVolume])

  useEffect(() => {
    if (display && !isDraggingBrightness && Date.now() > skipPollUntilRef.current) {
      setLocalBrightness(display.brightness)
    }
  }, [display, isDraggingBrightness])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetchAll()
    checkPowerStatus()
    pollRef.current = setInterval(checkPowerStatus, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchAll])

  const checkPowerStatus = async () => {
    try {
      const status = await powerStatus()
      if (status.has_pending && status.action && status.remaining_secs != null) {
        setPendingAction({ action: status.action, remaining: status.remaining_secs })
      } else {
        setPendingAction(null)
      }
    } catch { /* ignore */ }
  }

  const handlePowerAction = async (action: string) => {
    haptic()
    setPowerLoading(true)
    try {
      const data = await powerAction(action, false)
      if (data.active_transfers && data.active_transfers > 0) {
        setConfirmDialog({ action, type: "immediate", transfers: data.active_transfers })
      } else if (data.success) {
        toastStore.addToast(data.message || "Command scheduled.", "success")
        checkPowerStatus()
      } else {
        toastStore.addToast(data.message || "Action failed.", "error")
      }
    } catch {
      toastStore.addToast("Network connection error.", "error")
    } finally {
      setPowerLoading(false)
    }
  }

  const handleSchedulePower = async () => {
    haptic()
    const mins = parseInt(scheduleTime, 10)
    if (isNaN(mins) || mins <= 0) {
      toastStore.addToast("Please enter a valid duration in minutes.", "error")
      return
    }
    setPowerLoading(true)
    setIsScheduleOpen(false)
    try {
      const data = await schedulePower(scheduleAction, mins, scheduleForce, false)
      if (data.active_transfers && data.active_transfers > 0) {
        setConfirmDialog({
          action: scheduleAction,
          type: "scheduled",
          delay: mins,
          force: scheduleForce,
          transfers: data.active_transfers
        })
      } else if (data.success) {
        toastStore.addToast(data.message || "Action scheduled.", "success")
        checkPowerStatus()
      } else {
        toastStore.addToast(data.message || "Failed to schedule action.", "error")
      }
    } catch {
      toastStore.addToast("Network connection error.", "error")
    } finally {
      setPowerLoading(false)
    }
  }

  const handleConfirmed = async () => {
    if (!confirmDialog) return
    const { action, type, delay, force } = confirmDialog
    setConfirmDialog(null)
    setPowerLoading(true)
    try {
      let data
      if (type === "scheduled" && delay !== undefined && force !== undefined) {
        data = await schedulePower(action, delay, force, true)
      } else {
        data = await powerAction(action, true)
      }
      if (data.success) {
        toastStore.addToast(data.message || "Action executed.", "success")
        checkPowerStatus()
      } else {
        toastStore.addToast(data.message || "Action failed.", "error")
      }
    } catch {
      toastStore.addToast("Network connection error.", "error")
    } finally {
      setPowerLoading(false)
    }
  }

  const handleCancel = async () => {
    haptic()
    setPowerLoading(true)
    try {
      const data = await cancelPower()
      if (data.success) {
        toastStore.addToast("Power action cancelled successfully.", "success")
        setPendingAction(null)
      } else {
        toastStore.addToast(data.message || "Cancellation failed.", "error")
      }
    } catch {
      toastStore.addToast("Failed to cancel scheduled command.", "error")
    } finally {
      setPowerLoading(false)
    }
  }

  const handleToggle = async (type: "wifi" | "dnd", val: boolean) => {
    haptic()
    try {
      await toggleControlCenter(type, val)
      toastStore.addToast(`${type === "wifi" ? "WiFi" : "Do Not Disturb"} successfully updated.`, "success")
    } catch (err: any) {
      toastStore.addToast(err.message || `Failed to update ${type}.`, "error")
    }
  }

  const handleMedia = async (action: string) => {
    haptic()
    try {
      await triggerMedia(action)
    } catch (err: any) {
      toastStore.addToast(err.message || "Media action failed.", "error")
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Banner: Pending scheduled actions */}
      {pendingAction && (
        <Card variant="glass" className="flex items-center justify-between gap-4 p-5 animate-pulse border-destructive/20 bg-destructive/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <Power className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-semibold capitalize text-destructive text-sm">{pendingAction.action} Scheduled</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Executing in {Math.floor(pendingAction.remaining / 60)}m {pendingAction.remaining % 60}s ({pendingAction.remaining}s remaining)
              </p>
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={handleCancel} disabled={powerLoading}>
            {powerLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Cancel Action"}
          </Button>
        </Card>
      )}

      {/* 1. Mobile-Style Quick Toggles Grid */}
      <Card variant="glass" className="p-6">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 flex items-center justify-between">
          <span>Quick Panel</span>
          <InfoButton content="WiFi/Bluetooth toggles control card radios, DND disables popups, and Mute silences standard outputs." />
        </h3>
        
        {!toggles ? (
          <div className="grid grid-cols-3 gap-3.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3.5">
            {/* Wifi Toggle */}
            <button
              type="button"
              onClick={() => handleToggle("wifi", !toggles.wifi)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-200 text-center select-none border border-border/10",
                toggles.wifi
                  ? "neu-inset text-primary bg-primary/10 border-primary/20 shadow-sm"
                  : "neu-control text-muted-foreground"
              )}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-background/85 border border-border/30 mb-2.5">
                {toggles.wifi ? <Wifi className="h-4 w-4 text-primary" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
              </div>
              <span className="font-semibold text-xs leading-none">Wi-Fi</span>
              <span className="text-[9px] text-muted-foreground mt-1 leading-none">{toggles.wifi ? "Active" : "Disabled"}</span>
            </button>

            {/* Mute Toggle */}
            <button
              type="button"
              onClick={() => audio && setMuted(!audio.muted)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-200 text-center select-none border border-border/10",
                audio?.muted
                  ? "neu-inset text-primary bg-primary/10 border-primary/20 shadow-sm"
                  : "neu-control text-muted-foreground"
              )}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-background/85 border border-border/30 mb-2.5">
                {audio?.muted ? <VolumeX className="h-4 w-4 text-destructive" /> : <Volume2 className="h-4 w-4 text-primary" />}
              </div>
              <span className="font-semibold text-xs leading-none">Mute Sound</span>
              <span className="text-[9px] text-muted-foreground mt-1 leading-none">{audio?.muted ? "Muted" : "Active"}</span>
            </button>

            {/* DND Toggle */}
            <button
              type="button"
              onClick={() => handleToggle("dnd", !toggles.dnd)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-200 text-center select-none border border-border/10",
                toggles.dnd
                  ? "neu-inset text-primary bg-primary/10 border-primary/20 shadow-sm"
                  : "neu-control text-muted-foreground"
              )}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-background/85 border border-border/30 mb-2.5">
                {toggles.dnd ? <BellOff className="h-4 w-4 text-purple-500" /> : <Bell className="h-4 w-4 text-muted-foreground" />}
              </div>
              <span className="font-semibold text-xs leading-none">DND Mode</span>
              <span className="text-[9px] text-muted-foreground mt-1 leading-none">{toggles.dnd ? "Active" : "Disabled"}</span>
            </button>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 2. Audio Widget */}
        <Card variant="glass" className="p-6 flex flex-col justify-between space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 flex items-center justify-between">
              <span>Audio Control</span>
              <InfoButton content="Drag slider to set system master volume. Choose output default endpoint instantly from dropdown." />
            </h3>
            
            {!audio ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Volume Slider */}
                <div className="space-y-3.5">
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="flex items-center gap-1.5 text-foreground/80">
                      {audio.muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-primary" />}
                      Master Volume
                    </span>
                    <span className="text-primary font-bold">{audio.volume}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={localVolume}
                      onMouseDown={() => setIsDraggingVolume(true)}
                      onTouchStart={() => setIsDraggingVolume(true)}
                      onChange={(e) => setLocalVolume(parseInt(e.target.value, 10))}
                      onMouseUp={async (e) => {
                        setIsDraggingVolume(false)
                        skipPollUntilRef.current = Date.now() + 4000
                        const val = parseInt((e.target as HTMLInputElement).value, 10)
                        try { await setVolume(val) } catch (err: any) { toastStore.addToast(err.message || "Failed to set volume.", "error") }
                      }}
                      onTouchEnd={async (e) => {
                        setIsDraggingVolume(false)
                        skipPollUntilRef.current = Date.now() + 4000
                        const val = parseInt((e.target as HTMLInputElement).value, 10)
                        try { await setVolume(val) } catch (err: any) { toastStore.addToast(err.message || "Failed to set volume.", "error") }
                      }}
                      className="w-full h-1.5 rounded-full accent-primary bg-muted focus:outline-none touch-none"
                    />
                  </div>
                </div>

                {/* Output Device */}
                <div className="space-y-2">
                  <label htmlFor="output-device-select-controls" className="text-xs font-semibold text-muted-foreground block">
                    Output Destination
                  </label>
                  <div className="relative">
                    <select
                      id="output-device-select-controls"
                      value={audio.default_device}
                      onChange={(e) => setDevice(e.target.value)}
                      className="w-full bg-background border border-border/50 text-sm rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer appearance-none pr-8 font-medium"
                    >
                      {audio.devices.length === 0 ? (
                        <option value={audio.default_device}>{audio.default_device}</option>
                      ) : (
                        audio.devices.map((dev) => (
                          <option key={dev} value={dev}>
                            {dev}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Media keys */}
          <div className="border-t border-border/30 pt-4">
            <span className="text-xs font-semibold text-muted-foreground block mb-3">Media Center</span>
            <div className="flex items-center justify-around gap-2 bg-muted/20 p-2 rounded-xl border border-border/40">
              <Button size="icon" variant="ghost" className="rounded-xl h-9 w-9" onClick={() => handleMedia("prev")} title="Previous">
                <SkipBack className="h-4.5 w-4.5" />
              </Button>
              <Button size="icon" className="rounded-xl h-10 w-10 bg-primary/10 hover:bg-primary/20 text-primary active:scale-[0.93] transition-transform" onClick={() => handleMedia("play_pause")} title="Play/Pause">
                <Play className="h-4.5 w-4.5" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-xl h-9 w-9" onClick={() => handleMedia("next")} title="Next">
                <SkipForward className="h-4.5 w-4.5" />
              </Button>
              <div className="h-6 w-px bg-border/60 mx-1" />
              <Button size="icon" variant="ghost" className="rounded-xl h-9 w-9" onClick={() => handleMedia("volume_down")} title="Volume Down">
                <Volume1 className="h-4.5 w-4.5" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-xl h-9 w-9" onClick={() => handleMedia("volume_up")} title="Volume Up">
                <Volume2 className="h-4.5 w-4.5" />
              </Button>
            </div>
          </div>
        </Card>

        {/* 3. Display Widget */}
        <Card variant="glass" className="p-6 flex flex-col justify-between space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 flex items-center justify-between">
              <span>Display control</span>
              <InfoButton content="Adjust local screen monitor brightness percentage instantly." />
            </h3>
            
            {!display ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Brightness Slider */}
                <div className="space-y-3.5">
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="flex items-center gap-1.5 text-foreground/80">
                      <Sun className="h-4 w-4 text-primary" />
                      Screen Brightness
                    </span>
                    <span className="text-primary font-bold">{display.brightness}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={localBrightness}
                      onMouseDown={() => setIsDraggingBrightness(true)}
                      onTouchStart={() => setIsDraggingBrightness(true)}
                      onChange={(e) => setLocalBrightness(parseInt(e.target.value, 10))}
                      onMouseUp={async (e) => {
                        setIsDraggingBrightness(false)
                        skipPollUntilRef.current = Date.now() + 4000
                        const val = parseInt((e.target as HTMLInputElement).value, 10)
                        try { await setBrightness(val) } catch (err: any) { toastStore.addToast(err.message || "Failed to set brightness.", "error") }
                      }}
                      onTouchEnd={async (e) => {
                        setIsDraggingBrightness(false)
                        skipPollUntilRef.current = Date.now() + 4000
                        const val = parseInt((e.target as HTMLInputElement).value, 10)
                        try { await setBrightness(val) } catch (err: any) { toastStore.addToast(err.message || "Failed to set brightness.", "error") }
                      }}
                      className="w-full h-1.5 rounded-full accent-primary bg-muted focus:outline-none touch-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/30 pt-4 text-xs text-muted-foreground flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground/60" />
            <span className="font-semibold text-muted-foreground/75">Reflects primary active monitor.</span>
          </div>
        </Card>
      </div>

      {/* 4. Power Controls & Scheduler Widget */}
      <Card variant="glass" className="p-6">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-border/20 pb-4 mb-5 relative z-10">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Power Console</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-medium leading-relaxed">Shutdown, restart, or lock your remote system workspace securely</p>
          </div>
          <Button variant="outline" size="sm" className="flex items-center gap-1.5 border-primary/20 hover:border-primary/50 text-primary h-9 rounded-xl" onClick={() => setIsScheduleOpen(true)}>
            <Sliders className="h-3.5 w-3.5" />
            Schedule Delay Action
          </Button>
        </div>

        {/* Action Button Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 relative z-10">
          {cards.map((card) => (
            <button
              type="button"
              key={card.action}
              onClick={() => !pendingAction && handlePowerAction(card.action)}
              className={cn(
                "rounded-2xl p-5 text-left transition-all duration-200 border border-border/10 relative overflow-hidden select-none",
                card.destructive ? "hover:border-destructive/30" : "hover:border-primary/30",
                pendingAction ? "opacity-45 cursor-not-allowed" : "neu-control hover:scale-[1.01] hover:shadow-md"
              )}
              disabled={pendingAction != null}
            >
              <div className={cn(
                "w-[38px] h-[38px] rounded-xl flex items-center justify-center mb-3.5 shrink-0 transition-colors",
                card.destructive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
              )}>
                <card.icon className="w-[18px] h-[18px]" />
              </div>
              <h4 className="font-semibold text-xs text-foreground/90 leading-none">{card.label}</h4>
              <p className="text-[10px] text-muted-foreground/80 leading-normal mt-1.5">{card.desc}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* Scheduled Power Modal */}
      {isScheduleOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4 animate-fade-in">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsScheduleOpen(false)}
            role="presentation"
            aria-hidden="true"
          />
          {/* Container */}
          <div className="bg-popover border border-border/40 rounded-3xl p-6 w-full max-w-md shadow-2xl animate-scale-in relative z-10">
            <div className="flex justify-between items-center border-b border-border/20 pb-3.5 mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
                <Power className="h-4 w-4 text-primary" />
                Scheduler
              </h3>
              <Button type="button" variant="ghost" size="icon" onClick={() => setIsScheduleOpen(false)} className="h-8 w-8 rounded-lg hover:bg-muted/15">✕</Button>
            </div>
            
            <div className="space-y-4">
              {/* Action selection */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Select action</span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { action: "shutdown", label: "Shutdown", icon: Power, destructive: true },
                    { action: "restart", label: "Restart", icon: RefreshCw, destructive: false },
                    { action: "sleep", label: "Sleep", icon: Moon, destructive: false },
                    { action: "hibernate", label: "Hibernate", icon: Bed, destructive: false },
                    { action: "signout", label: "Sign Out", icon: LogOut, destructive: false },
                    { action: "lock", label: "Lock", icon: Lock, destructive: false },
                  ].map((act) => (
                    <button
                      type="button"
                      key={act.action}
                      onClick={() => setScheduleAction(act.action)}
                      className={cn(
                        "py-2 px-2.5 rounded-xl border text-xs font-semibold transition-all text-center flex flex-col items-center gap-1.5 select-none border-border/10",
                        scheduleAction === act.action
                          ? act.destructive
                            ? "bg-destructive/15 border-destructive/30 text-destructive"
                            : "bg-primary/15 border-primary/30 text-primary"
                          : "bg-muted/30 hover:bg-accent text-muted-foreground"
                      )}
                    >
                      <act.icon className="h-4 w-4" />
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time selection */}
              <div className="space-y-2">
                <label htmlFor="schedule-delay-input-controls" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Delay interval (minutes)</label>
                <div className="flex items-center gap-3">
                  <Input
                    id="schedule-delay-input-controls"
                    type="number"
                    min="1"
                    value={scheduleTime}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduleTime(e.target.value)}
                    className="h-11 font-semibold"
                  />
                </div>
                <div className="flex flex-wrap gap-2.5 pt-1.5 select-none">
                  {["1", "5", "15", "30", "60"].map((mins) => (
                    <button
                      type="button"
                      key={mins}
                      onClick={() => setScheduleTime(mins)}
                      className={cn(
                        "py-1 px-3.5 rounded-full border text-xs font-semibold transition-all duration-150 active:scale-95",
                        scheduleTime === mins ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 border-border/40 hover:bg-accent"
                      )}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Force Option */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-border/50 bg-muted/20">
                <div className="space-y-0.5 mr-2">
                  <p className="text-xs font-semibold text-foreground/80">Force Kill apps</p>
                  <p className="text-[10px] text-muted-foreground leading-normal">Kill all running applications immediately without saving prompt.</p>
                </div>
                <Switch
                  checked={scheduleForce}
                  onChange={setScheduleForce}
                  aria-label="Force Action"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3.5 border-t border-border/20 pt-4 mt-6">
              <Button variant="ghost" onClick={() => setIsScheduleOpen(false)}>Cancel</Button>
              <Button variant={scheduleAction === "shutdown" ? "destructive" : "default"} onClick={handleSchedulePower}>
                Schedule Action
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for ongoing file transfers */}
      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={() => setConfirmDialog(null)}
        title="Active file transfer in progress"
        description={`${confirmDialog?.transfers} file transfer(s) are currently in progress. Proceeding with ${confirmDialog?.action} will terminate these active transfers.`}
        confirmText="Proceed Anyway"
        actionLabel="Execute"
        onConfirm={handleConfirmed}
      />
    </div>
  )
}
