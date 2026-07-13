import { useState, useEffect, useRef } from "react"
import {
  Power, RefreshCw, Moon, Bed, LogOut, Lock, SwitchCamera,
  Sun, Volume2, VolumeX, Volume1, Bell, BellOff,
  SkipBack, SkipForward, Loader2, Sliders,
  Wifi, WifiOff, Signal, MonitorOff
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useHardwareStore, useToastStore } from "@/lib/store"
import { Skeleton } from "@/components/ui/skeleton"

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
  action: string, delayMins: number, force: boolean, confirmed: boolean
): Promise<PowerResponse> {
  const res = await fetch("/api/power/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, delay_mins: delayMins, force, confirmed }),
  })
  return res.json()
}

const powerCards = [
  { action: "shutdown", label: "Shutdown", desc: "Power off completely", icon: Power, destructive: true },
  { action: "restart", label: "Restart", desc: "Reboot the system", icon: RefreshCw, destructive: false },
  { action: "sleep", label: "Sleep", desc: "Low-power state", icon: Moon, destructive: false },
  { action: "hibernate", label: "Hibernate", desc: "Save state and power off", icon: Bed, destructive: false },
  { action: "signout", label: "Sign Out", desc: "Log out current session", icon: LogOut, destructive: false },
  { action: "lock", label: "Lock", desc: "Lock the workstation", icon: Lock, destructive: false },
  { action: "switchuser", label: "Switch User", desc: "Go to login screen", icon: SwitchCamera, destructive: false },
]

function PlayPauseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="14" y="4" width="4" height="16" rx="1" />
      <path d="M4 18V6l10 6-10 6Z" />
    </svg>
  )
}

export function ControlCenterPage() {
  const toastStore = useToastStore()
  const {
    audio, display, network, wifiNetworks, controlCenter,
    fetchAll, fetchNetwork, fetchWifiNetworks, fetchControlCenter,
    setVolume, setDevice, triggerMedia,
    setBrightness, setNightLight, setDarkMode,
    toggleControlCenter, flushDns, toggleAdapter,
    wifiConnect, wifiDisconnect, monitorOff
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

  const [networkConfirm, setNetworkConfirm] = useState<{
    type: "flush-dns" | "adapter" | "wifi-disconnect" | "monitor-off"
    name?: string
  } | null>(null)

  const [connectingSsid, setConnectingSsid] = useState<string | null>(null)
  const [connectPassword, setConnectPassword] = useState("")

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
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetchAll()
    fetchNetwork()
    fetchWifiNetworks()
    fetchControlCenter()
    syncPollRef.current = setInterval(() => {
      if (Date.now() > skipPollUntilRef.current) {
        fetchAll()
      }
    }, 5000)
    checkPowerStatus()
    pollRef.current = setInterval(checkPowerStatus, 1000)
    return () => {
      if (syncPollRef.current) clearInterval(syncPollRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchAll, fetchNetwork, fetchWifiNetworks, fetchControlCenter])

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
          action: scheduleAction, type: "scheduled", delay: mins, force: scheduleForce, transfers: data.active_transfers
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

  const handleWifiConnect = async (ssid: string) => {
    const net = wifiNetworks.find(n => n.ssid === ssid)
    const isOpen = net?.security_type?.toLowerCase() === "open" || net?.security_type?.toLowerCase() === "none"
    try {
      await wifiConnect(ssid, isOpen ? undefined : connectPassword || undefined)
      toastStore.addToast(`Connected to ${ssid}.`, "success")
      setConnectingSsid(null)
      setConnectPassword("")
    } catch (err: any) {
      toastStore.addToast(err.message || "Failed to connect.", "error")
    }
  }

  const handleConfirmedNetworkAction = async () => {
    if (!networkConfirm) return
    const { type, name } = networkConfirm
    setNetworkConfirm(null)
    try {
      if (type === "flush-dns") {
        await flushDns()
        toastStore.addToast("DNS cache flushed successfully.", "success")
      } else if (type === "adapter" && name) {
        await toggleAdapter(name, false)
        toastStore.addToast("Adapter disabled.", "info")
      } else if (type === "wifi-disconnect") {
        await wifiDisconnect()
        toastStore.addToast("Wi-Fi disconnected.", "info")
      } else if (type === "monitor-off") {
        await monitorOff()
        toastStore.addToast("Monitor turned off.", "success")
      }
    } catch (err: any) {
      toastStore.addToast(err.message || "Action failed.", "error")
    }
  }

  const handleToggle = async (type: "dark", val: boolean) => {
    try {
      if (type === "dark") await setDarkMode(val)
      toastStore.addToast("Theme mode updated.", "success")
    } catch (err: any) {
      toastStore.addToast(err.message || "Failed to update theme mode.", "error")
    }
  }

  const handleMedia = async (action: string) => {
    try {
      await triggerMedia(action)
    } catch (err: any) {
      toastStore.addToast(err.message || "Media action failed.", "error")
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Quick Toggles */}
      <div className="relative rounded-xl border border-border/50 bg-card backdrop-blur-xl saturate-[1.4] p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider relative">Quick Toggles</h3>
        {!controlCenter ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {controlCenter.wifi_on !== null && (
              <button
                onClick={() => toggleControlCenter("wifi", !controlCenter.wifi_on)}
                className={cn(
                    "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                    controlCenter.wifi_on
                      ? "bg-primary/10 border-primary/30 text-primary shadow-sm backdrop-blur-sm"
                      : "neu-hover text-muted-foreground"
                )}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                  {controlCenter.wifi_on ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
                </div>
                <span className="font-medium text-xs">Wi-Fi</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{controlCenter.wifi_on ? "On" : "Off"}</span>
              </button>
            )}
            {controlCenter.dnd_on !== null && (
              <button
                onClick={() => toggleControlCenter("dnd", !controlCenter.dnd_on)}
                className={cn(
                    "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                    controlCenter.dnd_on
                      ? "bg-primary/10 border-primary/30 text-primary shadow-sm backdrop-blur-sm"
                      : "neu-hover text-muted-foreground"
                )}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                  {controlCenter.dnd_on ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
                </div>
                <span className="font-medium text-xs">DND</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{controlCenter.dnd_on ? "On" : "Off"}</span>
              </button>
            )}
            <button
              onClick={() => handleToggle("dark", !(controlCenter?.dark_mode ?? false))}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-200 text-center",
                controlCenter?.dark_mode
                  ? "bg-primary/10 border-primary/30 text-primary shadow-sm backdrop-blur-sm"
                  : "neu-hover text-muted-foreground"
              )}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-background/80 border mb-2">
                {controlCenter?.dark_mode ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              </div>
              <span className="font-medium text-xs">Dark Mode</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{controlCenter?.dark_mode ? "Dark" : "Light"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Audio + Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="relative rounded-xl border border-border/50 bg-card backdrop-blur-xl saturate-[1.4] p-6 flex flex-col justify-between space-y-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Audio Control</h3>
            {!audio ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className="flex items-center gap-1.5">
                      {audio.muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-primary" />}
                      Master Volume
                    </span>
                    <span className="text-primary font-semibold">{localVolume}%</span>
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
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary focus:outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="output-device-select" className="text-xs font-semibold text-muted-foreground">Output Device</label>
                  <select id="output-device-select" value={audio.default_device} onChange={(e) => setDevice(e.target.value)}
                    className="w-full bg-background/50 backdrop-blur-sm border border-border text-sm rounded-xl p-2.5 outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer transition-all"
                  >
                    {audio.devices.length === 0 ? (
                      <option value={audio.default_device}>{audio.default_device}</option>
                    ) : (
                      audio.devices.map((dev) => <option key={dev} value={dev}>{dev}</option>)
                    )}
                  </select>
                </div>
              </div>
            )}
          </div>
          <div className="border-t pt-4">
            <span className="text-xs font-semibold text-muted-foreground block mb-3">Media Controls</span>
            <div className="flex items-center justify-around gap-2 bg-muted/20 backdrop-blur-sm p-2.5 rounded-xl border border-border/50">
              <Button size="icon" variant="ghost" className="rounded-full" onClick={() => handleMedia("prev")} title="Previous">
                <SkipBack className="h-5 w-5" />
              </Button>
              <Button size="icon" variant="ghost" className="rounded-full p-2.5 bg-primary/10 hover:bg-primary/20 text-primary" onClick={() => handleMedia("play_pause")} title="Play/Pause">
                <PlayPauseIcon className="h-5 w-5" />
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

        <div className="relative rounded-xl border border-border/50 bg-card backdrop-blur-xl saturate-[1.4] p-6 flex flex-col justify-between space-y-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 relative">Display & Brightness</h3>
            {!display ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className="flex items-center gap-1.5">
                      <Sun className="h-4 w-4 text-primary" />
                      Screen Brightness
                    </span>
                    <span className="text-primary font-semibold">{localBrightness}%</span>
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
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-muted/10 backdrop-blur-sm">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Night Light</p>
                    <p className="text-xs text-muted-foreground">Reduce blue light</p>
                  </div>
                  <button aria-label="Toggle Night Light" onClick={() => { setNightLight(!display.night_light).catch((err) => { toastStore.addToast(err.message || "Failed to toggle Night Light.", "error") }) }}
                    className={cn("w-12 h-6 flex items-center rounded-full p-1 transition-all outline-none", display.night_light ? "bg-primary" : "bg-muted border")}
                  >
                    <div className={cn("w-4 h-4 bg-background rounded-full shadow-md transform transition-all duration-200", display.night_light ? "translate-x-6" : "translate-x-0")} />
                  </button>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-muted/10 backdrop-blur-sm">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Monitor</p>
                    <p className="text-xs text-muted-foreground">Turn off display</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setNetworkConfirm({ type: "monitor-off" })}>
                    <MonitorOff className="h-4 w-4 mr-1.5" />
                    Turn Off
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Network */}
      <div className="relative rounded-xl border border-border/50 bg-card backdrop-blur-xl saturate-[1.4] p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 relative">Network</h3>
        {!network ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 rounded-xl bg-muted/20 border border-border/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">IPv4</p>
                <p className="font-mono text-sm font-semibold">{network.ipv4 || "—"}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Gateway</p>
                <p className="font-mono text-sm font-semibold">{network.default_gateway || "—"}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="text-sm font-semibold capitalize">{network.connection_type || "—"}</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border/50 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Connectivity</p>
                <p className="text-sm font-semibold">
                  {network.internet_connection === null ? "Unknown" :
                   network.internet_connection ? "Connected" : "No Internet"}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Interfaces</p>
              {network.interfaces.map((iface) => (
                <div key={iface.name} className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-muted/10 backdrop-blur-sm">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-2 h-2 rounded-full", iface.status === "up" ? "bg-green-500" : "bg-red-500")} />
                    <div>
                      <p className="text-sm font-medium">{iface.name}</p>
                      <p className="text-xs text-muted-foreground">{iface.mac}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground capitalize">{iface.interface_type}</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setNetworkConfirm({ type: "adapter", name: iface.name })}>
                      {iface.status === "up" ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setNetworkConfirm({ type: "flush-dns" })}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Flush DNS
              </Button>
              <Button variant="outline" size="sm" onClick={() => fetchWifiNetworks()}>
                <Wifi className="h-3.5 w-3.5 mr-1.5" /> Scan Wi-Fi
              </Button>
            </div>
            {wifiNetworks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Wi-Fi Networks</p>
                {wifiNetworks.map((net) => {
                  const isConnecting = connectingSsid === net.ssid
                  return (
                    <div key={net.ssid} className="p-3 rounded-xl border border-border/50 bg-muted/10 backdrop-blur-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Signal className={cn("h-4 w-4", net.connected ? "text-primary" : "text-muted-foreground")} />
                          <div>
                            <p className="text-sm font-medium">{net.ssid}</p>
                            <p className="text-xs text-muted-foreground">{net.security_type} · {net.signal_strength}%</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!net.connected && !isConnecting && (
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => {
                                const isOpen = net.security_type?.toLowerCase() === "open" || net.security_type?.toLowerCase() === "none"
                                if (isOpen) {
                                  handleWifiConnect(net.ssid)
                                } else {
                                  setConnectingSsid(net.ssid)
                                  setConnectPassword("")
                                }
                              }}>
                              <Wifi className="h-3 w-3 mr-1" />
                              Connect
                            </Button>
                          )}
                          {net.connected && (
                            <Button size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => setNetworkConfirm({ type: "wifi-disconnect" })}>
                              Disconnect
                            </Button>
                          )}
                        </div>
                      </div>
                      {isConnecting && (
                        <div className="flex items-center gap-2 pl-9">
                          <input
                            type="password"
                            value={connectPassword}
                            onChange={(e) => setConnectPassword(e.target.value)}
                            placeholder="Enter Wi-Fi password"
                            className="flex-1 h-8 text-xs bg-background/50 backdrop-blur-sm border border-border rounded-xl px-3 outline-none focus:ring-1 focus:ring-primary transition-all"
                            onKeyDown={(e) => e.key === "Enter" && handleWifiConnect(net.ssid)}
                          />
                          <Button size="sm" className="h-8 text-xs" onClick={() => handleWifiConnect(net.ssid)}>
                            Join
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs"
                            onClick={() => { setConnectingSsid(null); setConnectPassword("") }}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {pendingAction && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 backdrop-blur-sm saturate-[1.4] p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <Power className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-semibold capitalize text-destructive">{pendingAction.action} Scheduled</p>
              <p className="text-sm text-muted-foreground">
                Executing in {Math.floor(pendingAction.remaining / 60)}m {pendingAction.remaining % 60}s
              </p>
            </div>
          </div>
          <Button variant="destructive" onClick={handleCancel} disabled={powerLoading}>
            {powerLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cancel
          </Button>
        </div>
      )}

      {/* Power */}
      <div className="relative rounded-xl border border-border/50 bg-card backdrop-blur-xl saturate-[1.4] p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-border/30 pb-4 mb-6 relative">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Power Management</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Shutdown, restart, or lock your computer remotely</p>
          </div>
          <Button variant="outline" className="flex items-center gap-1.5 border-primary/20 hover:border-primary/50 text-primary"
            onClick={() => setIsScheduleOpen(true)}>
            <Sliders className="h-4 w-4" />
            Schedule
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {powerCards.map((card) => (
            <button key={card.action} onClick={() => !pendingAction && handlePowerAction(card.action)}
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

      {/* Schedule Modal */}
      {isScheduleOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm saturate-[1.4] flex items-center justify-center z-50 p-4">
          <div className="bg-card backdrop-blur-2xl saturate-[1.6] border border-border/50 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Power className="h-5 w-5 text-primary" />
                Schedule Power Action
              </h3>
              <button onClick={() => setIsScheduleOpen(false)} className="text-muted-foreground hover:text-foreground text-sm font-medium">✕</button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground block">Action type</span>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setScheduleAction("shutdown")}
                    className={cn("py-2.5 px-4 rounded-xl border text-sm font-medium transition-all text-center",
                      scheduleAction === "shutdown"
                        ? "bg-destructive/15 border-destructive/30 text-destructive font-semibold"
                        : "bg-muted/40 hover:bg-muted/65 text-muted-foreground")}>
                    Shutdown
                  </button>
                  <button onClick={() => setScheduleAction("restart")}
                    className={cn("py-2.5 px-4 rounded-xl border text-sm font-medium transition-all text-center",
                      scheduleAction === "restart"
                        ? "bg-primary/15 border-primary/30 text-primary font-semibold"
                        : "bg-muted/40 hover:bg-muted/65 text-muted-foreground")}>
                    Restart
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="schedule-delay-input" className="text-xs font-semibold text-muted-foreground">Delay (minutes)</label>
                <input id="schedule-delay-input" type="number" min="1" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full bg-background/50 backdrop-blur-sm border border-border text-sm rounded-xl p-3 outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all" />
                <div className="flex flex-wrap gap-2 mt-2">
                  {["1", "5", "15", "30", "60"].map((mins) => (
                    <button key={mins} onClick={() => setScheduleTime(mins)}
                      className={cn("py-1 px-3 rounded-full border text-xs font-medium transition-colors backdrop-blur-sm",
                        scheduleTime === mins ? "bg-primary text-primary-foreground" : "bg-muted/30 border-border/50 hover:bg-muted/60")}>
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-muted/10 backdrop-blur-sm">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold">Force Action</p>
                  <p className="text-[10px] text-muted-foreground">Force close running programs</p>
                </div>
                <button aria-label="Force Action" onClick={() => setScheduleForce(!scheduleForce)}
                  className={cn("w-10 h-5 flex items-center rounded-full p-0.5 transition-all outline-none",
                    scheduleForce ? "bg-destructive" : "bg-muted border")}>
                  <div className={cn("w-4 h-4 bg-background rounded-full shadow transform transition-all duration-200",
                    scheduleForce ? "translate-x-5" : "translate-x-0")} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t pt-4 mt-6">
              <Button variant="ghost" onClick={() => setIsScheduleOpen(false)}>Cancel</Button>
              <Button variant={scheduleAction === "shutdown" ? "destructive" : "default"} onClick={handleSchedulePower}>
                Schedule
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={() => setConfirmDialog(null)}
        title="Active file transfer in progress"
        description={`${confirmDialog?.transfers} file transfer(s) are in progress. Proceeding will terminate them.`}
        confirmText="Proceed Anyway"
        actionLabel="Proceed Anyway"
        onConfirm={handleConfirmed}
      />

      <ConfirmDialog
        open={networkConfirm != null}
        onOpenChange={() => setNetworkConfirm(null)}
        title={networkConfirm?.type === "monitor-off" ? "Turn off monitor?" : "Confirm Network Change"}
        description={
          networkConfirm?.type === "flush-dns" ? "Flushing DNS may briefly disrupt network connectivity." :
          networkConfirm?.type === "adapter" ? `Disabling "${networkConfirm?.name}" will cut network access. You may lose connection to SysDeck.` :
          networkConfirm?.type === "wifi-disconnect" ? "Disconnecting from Wi-Fi may disconnect you from SysDeck." :
          networkConfirm?.type === "monitor-off" ? "The monitor will turn off. You need physical input to wake it." :
          "Are you sure?"
        }
        confirmText="Proceed"
        actionLabel={networkConfirm?.type === "monitor-off" ? "Turn Off" : "Continue"}
        onConfirm={handleConfirmedNetworkAction}
      />
    </div>
  )
}
