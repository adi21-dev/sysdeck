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
  Bluetooth,
  Play
} from "lucide-react"
import { Button } from "@/components/ui/button"
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
  { action: "restart", label: "Restart", desc: "Reboot the system", icon: RefreshCw, destructive: false },
  { action: "sleep", label: "Sleep", desc: "Low-power state", icon: Moon, destructive: false },
  { action: "hibernate", label: "Hibernate", desc: "Save state and power off", icon: Bed, destructive: false },
  { action: "signout", label: "Sign Out", desc: "Log out current session", icon: LogOut, destructive: false },
  { action: "lock", label: "Lock", desc: "Lock the workstation", icon: Lock, destructive: false },
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
    setNightLight,
    setWifi,
    setBluetooth,
    setDarkMode,
    setDnd
  } = useHardwareStore()

  // Power scheduler states
  const [pendingAction, setPendingAction] = useState<{ action: string; remaining: number } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; type: "immediate" | "scheduled"; delay?: number; force?: boolean; transfers: number } | null>(null)
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [scheduleTime, setScheduleTime] = useState("10")
  const [scheduleAction, setScheduleAction] = useState("shutdown")
  const [scheduleForce, setScheduleForce] = useState(false)
  const [powerLoading, setPowerLoading] = useState(false)

  // Local slider state for instant drag response
  const [localVolume, setLocalVolume] = useState(50)
  const [isDraggingVolume, setIsDraggingVolume] = useState(false)
  const [localBrightness, setLocalBrightness] = useState(50)
  const [isDraggingBrightness, setIsDraggingBrightness] = useState(false)
  const skipPollUntilRef = useRef<number>(0)

  // Sync local state from server updates (when not dragging)
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

  // Fetch initial hardware states
  useEffect(() => {
    fetchAll()

    // Check power scheduler status initially
    checkPowerStatus()
    // Poll power status every 1 second to update timer
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
    } catch {
      // ignore silently during polling
    }
  }

  const handlePowerAction = async (action: string) => {
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

  // Toggles wrapper
  const handleToggle = async (type: "wifi" | "bluetooth" | "dark" | "dnd", val: boolean) => {
    haptic()
    try {
      if (type === "wifi") await setWifi(val)
      else if (type === "bluetooth") await setBluetooth(val)
      else if (type === "dark") await setDarkMode(val)
      else if (type === "dnd") await setDnd(val)
      toastStore.addToast(`${type.replace("_", " ")} successfully updated.`, "success")
    } catch (err: any) {
      toastStore.addToast(err.message || `Failed to update ${type}.`, "error")
    }
  }

  // Media wrapper
  const handleMedia = async (action: string) => {
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
        <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 backdrop-blur-sm saturate-[1.4] p-5 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <Power className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-semibold capitalize text-destructive">{pendingAction.action} Scheduled</p>
              <p className="text-sm text-muted-foreground">
                Executing in {Math.floor(pendingAction.remaining / 60)}m {pendingAction.remaining % 60}s ({pendingAction.remaining}s remaining)
              </p>
            </div>
          </div>
          <Button variant="destructive" onClick={handleCancel} disabled={powerLoading}>
            {powerLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cancel Scheduled
          </Button>
        </div>
      )}

      {/* 1. Mobile-Style Quick Toggles Grid */}
      <div className="glass-card p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider relative">Quick Toggles<InfoButton content={"Quick system toggles:\nWi-Fi/Bluetooth — radio on/off\nDark Mode — light/dark theme\nMute — silence all audio\nDND — suppress notifications\n\nExample: toggle Wi-Fi off when using wired ethernet to save power."} className="ml-1.5 align-middle" /></h3>
        {!toggles ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {/* Wifi Toggle */}
            <button
              onClick={() => handleToggle("wifi", !toggles.wifi)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                toggles.wifi
                  ? "bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10 backdrop-blur-sm"
                  : "neu-hover text-muted-foreground"
              )}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                {toggles.wifi ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
              </div>
              <span className="font-medium text-xs">Wi-Fi</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{toggles.wifi ? "Enabled" : "Disabled"}</span>
            </button>

            {/* Bluetooth Toggle */}
            <button
              onClick={() => handleToggle("bluetooth", !toggles.bluetooth)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                toggles.bluetooth
                  ? "bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10 backdrop-blur-sm"
                  : "neu-hover text-muted-foreground"
              )}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                <Bluetooth className="h-5 w-5" />
              </div>
              <span className="font-medium text-xs">Bluetooth</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{toggles.bluetooth ? "Enabled" : "Disabled"}</span>
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={() => handleToggle("dark", !toggles.dark_mode)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                toggles.dark_mode
                  ? "bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10 backdrop-blur-sm"
                  : "neu-hover text-muted-foreground"
              )}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                {toggles.dark_mode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </div>
              <span className="font-medium text-xs">Dark Mode</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{toggles.dark_mode ? "Dark" : "Light"}</span>
            </button>

            {/* Mute Toggle */}
            <button
              onClick={() => audio && setMuted(!audio.muted)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                audio?.muted
                  ? "bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10 backdrop-blur-sm"
                  : "neu-hover text-muted-foreground"
              )}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                {audio?.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </div>
              <span className="font-medium text-xs">Audio Muted</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{audio?.muted ? "Muted" : "Active"}</span>
            </button>

            {/* DND Toggle */}
            <button
              onClick={() => handleToggle("dnd", !toggles.dnd)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                toggles.dnd
                  ? "bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10 backdrop-blur-sm"
                  : "neu-hover text-muted-foreground"
              )}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                {toggles.dnd ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              </div>
              <span className="font-medium text-xs">Do Not Disturb</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{toggles.dnd ? "Active" : "Inactive"}</span>
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 2. Audio Widget */}
        <div className="glass-card p-6 flex flex-col justify-between space-y-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Audio Control<InfoButton content={"Volume control + output device selector.\n\nExample: switch from speakers to headphones without unplugging — just select the device from the dropdown."} className="ml-1.5 align-middle" /></h3>
            {!audio ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Volume Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className="flex items-center gap-1.5">
                      {audio.muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-primary" />}
                      Master Volume
                    </span>
                    <span className="text-primary font-semibold">{audio.volume}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="range" min="0" max="100" value={localVolume}
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
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary focus:outline-none touch-none"
                    />
                  </div>
                </div>

                 {/* Output Device */}
                <div className="space-y-2">
                  <label htmlFor="output-device-select-controls" className="text-xs font-semibold text-muted-foreground">Output Device<InfoButton content={"Lists connected audio devices. Select one to route all system sound there.\n\nExample: plug in USB headphones and select them here to switch audio output instantly."} className="ml-1.5 align-middle" /></label>
                  <select
                    id="output-device-select-controls"
                    value={audio.default_device}
                    onChange={(e) => setDevice(e.target.value)}
                    className="w-full bg-background border border-border text-sm rounded-lg p-2.5 outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
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
                </div>
              </div>
            )}
          </div>

          {/* Media keys */}
          <div className="border-t pt-4">
            <span className="text-xs font-semibold text-muted-foreground block mb-3">Media Controls</span>
            <div className="flex items-center justify-around gap-2 bg-muted/20 p-2.5 rounded-xl border">
              <Button size="icon" variant="ghost" className="rounded-full" onClick={() => handleMedia("prev")} title="Previous">
                <SkipBack className="h-5 w-5" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full p-2.5 bg-primary/10 hover:bg-primary/20 text-primary" onClick={() => handleMedia("play_pause")} title="Play/Pause">
                <Play className="h-5 w-5" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full" onClick={() => handleMedia("next")} title="Next">
                <SkipForward className="h-5 w-5" />
              </Button>
              <div className="h-6 w-px bg-border mx-1" />
              <Button size="icon" variant="ghost" className="rounded-full" onClick={() => handleMedia("volume_down")} title="Volume Down">
                <Volume1 className="h-5 w-5" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full" onClick={() => handleMedia("volume_up")} title="Volume Up">
                <Volume2 className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* 3. Display Widget */}
        <div className="glass-card p-6 flex flex-col justify-between space-y-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Display & Brightness<InfoButton content={"Screen brightness slider + Night Light (blue light filter).\n\nExample: enable Night Light at night to reduce eye strain — the screen will take on a warmer tint."} className="ml-1.5 align-middle" /></h3>
            {!display ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Brightness Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className="flex items-center gap-1.5">
                      <Sun className="h-4 w-4 text-primary" />
                      Screen Brightness
                    </span>
                    <span className="text-primary font-semibold">{display.brightness}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="range" min="0" max="100" value={localBrightness}
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
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary focus:outline-none touch-none"
                    />
                  </div>
                </div>

                {/* Night Light Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-muted/10">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Night Light</p>
                    <p className="text-xs text-muted-foreground">Reduce blue light to help sleep</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={display.night_light}
                    aria-label="Toggle Night Light"
                    onClick={() => {
                      setNightLight(!display.night_light).catch((err) => {
                        toastStore.addToast(err.message || "Failed to toggle Night Light.", "error")
                      })
                    }}
                    className={cn(
                      "w-12 h-6 flex items-center rounded-full p-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
                      display.night_light ? "bg-primary shadow-[0_0_10px_hsl(173_80%_30%_/_0.3)]" : "bg-muted border shadow-inner"
                    )}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 bg-background rounded-full shadow-md transform transition-all duration-200",
                        display.night_light ? "translate-x-6" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4 text-xs text-muted-foreground flex items-center gap-1.5">
            <Monitor className="h-4 w-4" />
            <span>Display settings reflect your main connected screen.</span>
          </div>
        </div>
      </div>

      {/* 4. Power Controls & Scheduler Widget */}
      <div className="glass-card p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-border/30 pb-4 mb-6 relative">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Power Management<InfoButton content={"Remote power actions + scheduler.\nSupports: Shutdown, Restart, Sleep, Hibernate, Sign Out, Lock.\nSchedule any action to run after a delay (1-60 min).\n\nExample: schedule a restart at 2 AM to apply updates while you're away."} className="ml-1.5 align-middle" /></h3>
            <p className="text-xs text-muted-foreground mt-0.5">Shutdown, restart, or lock your computer remotely</p>
          </div>
          <Button variant="outline" className="flex items-center gap-1.5 border-primary/20 hover:border-primary/50 text-primary" onClick={() => setIsScheduleOpen(true)}>
            <Sliders className="h-4 w-4" />
            Schedule Power Action
          </Button>
        </div>

        {/* Action Button Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {cards.map((card) => (
            <button
              key={card.action}
              onClick={() => !pendingAction && handlePowerAction(card.action)}
              className={cn(
                "rounded-2xl border border-border/50 bg-card backdrop-blur-sm saturate-[1.4] p-5 text-left transition-all duration-200 hover:bg-accent/40 group relative overflow-hidden hover:-translate-y-0.5 hover:shadow-lg",
                card.destructive ? "hover:border-destructive/30" : "hover:border-primary/30",
                pendingAction && "opacity-45 cursor-not-allowed"
              )}
              disabled={pendingAction != null}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-colors relative",
                card.destructive ? "bg-destructive/10 group-hover:bg-destructive/15" : "bg-primary/10 group-hover:bg-primary/15"
              )}>
                <card.icon className={cn("w-5 h-5", card.destructive ? "text-destructive" : "text-primary")} />
              </div>
              <h4 className="font-semibold text-sm relative">{card.label}</h4>
              <p className="text-[11px] text-muted-foreground leading-tight mt-1 relative">{card.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled Power Modal */}
      {isScheduleOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm saturate-[1.4] flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-card backdrop-blur-2xl saturate-[1.6] border border-border/50 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Power className="h-5 w-5 text-primary" />
                Schedule Power Action
              </h3>
              <button onClick={() => setIsScheduleOpen(false)} className="text-muted-foreground hover:text-foreground text-sm font-medium">✕</button>
            </div>
            
            <div className="space-y-4">
              {/* Action selection */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground block">Action type</span>
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
                      key={act.action}
                      onClick={() => setScheduleAction(act.action)}
                      className={cn(
                        "py-2.5 px-3 rounded-xl border text-sm font-medium transition-all text-center flex flex-col items-center gap-1",
                        scheduleAction === act.action
                          ? act.destructive
                            ? "bg-destructive/15 border-destructive/30 text-destructive font-semibold"
                            : "bg-primary/15 border-primary/30 text-primary font-semibold"
                          : "bg-muted/40 hover:bg-muted/65 text-muted-foreground"
                      )}
                    >
                      <act.icon className="h-4 w-4" />
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time selection */}
              <div className="space-y-1.5">
                <label htmlFor="schedule-delay-input-controls" className="text-xs font-semibold text-muted-foreground">Delay (minutes)</label>
                <div className="flex items-center gap-3">
                  <input
                    id="schedule-delay-input-controls"
                    type="number"
                    min="1"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full bg-background border border-border text-sm rounded-xl p-3 outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["1", "5", "15", "30", "60"].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => setScheduleTime(mins)}
                      className={cn(
                        "py-1 px-3 rounded-full border text-xs font-medium transition-colors",
                        scheduleTime === mins ? "bg-primary text-primary-foreground" : "bg-muted/30 hover:bg-muted/60"
                      )}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Force Option */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/10">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold">Force Action</p>
                  <p className="text-[10px] text-muted-foreground">Force close running programs immediately</p>
                </div>
                <button
                  role="switch"
                  aria-checked={scheduleForce}
                  aria-label="Force Action"
                  onClick={() => setScheduleForce(!scheduleForce)}
                  className={cn(
                    "w-10 h-5 flex items-center rounded-full p-0.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
                    scheduleForce ? "bg-destructive shadow-[0_0_8px_hsl(0_80%_55%_/_0.3)]" : "bg-muted border shadow-inner"
                  )}
                >
                  <div
                    className={cn(
                      "w-4 h-4 bg-background rounded-full shadow transform transition-all duration-200",
                      scheduleForce ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t pt-4 mt-6">
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


