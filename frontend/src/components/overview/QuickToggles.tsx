import { useState } from "react"
import { Wifi, WifiOff, Volume2, VolumeX, Bell, BellOff, MonitorOff, Lock, Play, Pause, Sun, Moon } from "lucide-react"
import { useHardwareStore, useThemeStore } from "@/lib/store"
import { cn } from "@/lib/utils"

function ToggleButton({
  icon: Icon,
  activeIcon: ActiveIcon,
  label,
  active,
  loading,
  onClick,
  activeColor = "text-primary",
}: {
  icon: React.ElementType
  activeIcon: React.ElementType
  label: string
  active: boolean
  loading?: boolean
  onClick: () => void
  activeColor?: string
}) {
  const IconComp = active ? ActiveIcon : Icon
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition-all duration-200 active:scale-95",
        active
          ? `border-primary/30 bg-primary/10 ${activeColor}`
          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <IconComp className="h-5 w-5" />
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className="text-[9px] opacity-60">{active ? "On" : "Off"}</span>
    </button>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  color = "text-primary",
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border border-border/50 p-3 transition-all duration-200 active:scale-95",
        "text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <Icon className={cn("h-5 w-5", color)} />
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className="text-[9px] opacity-60">Tap</span>
    </button>
  )
}

export function QuickToggles() {
  const toggles = useHardwareStore((s) => s.toggles)
  const audio = useHardwareStore((s) => s.audio)
  const isDark = useThemeStore((s) => s.isDark)
  const toggleControlCenter = useHardwareStore((s) => s.toggleControlCenter)
  const setMuted = useHardwareStore((s) => s.setMuted)
  const setDarkMode = useHardwareStore((s) => s.setDarkMode)
  const monitorOff = useHardwareStore((s) => s.monitorOff)
  const triggerMedia = useHardwareStore((s) => s.triggerMedia)
  const lockWorkstation = useHardwareStore((s) => s.lockWorkstation)
  const [pending, setPending] = useState<string | null>(null)

  const handleToggle = async (key: string, enabled: boolean) => {
    setPending(key)
    navigator.vibrate?.(10)
    try {
      if (key === "mute") {
        await setMuted(enabled)
      } else {
        await toggleControlCenter(key, enabled)
      }
    } finally {
      setPending(null)
    }
  }

  const handleAction = async (key: string) => {
    setPending(key)
    navigator.vibrate?.(10)
    try {
      if (key === "monitor") await monitorOff()
      else if (key === "media") await triggerMedia("play_pause")
      else if (key === "lock") await lockWorkstation()
      else if (key === "dark") await setDarkMode(!isDark)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid grid-cols-4 gap-3 px-4">
      <ActionButton
        icon={MonitorOff}
        label="Monitor"
        onClick={() => handleAction("monitor")}
        color="text-sky-400"
      />
      <ActionButton
        icon={Lock}
        label="Lock"
        onClick={() => handleAction("lock")}
        color="text-rose-400"
      />
      <ActionButton
        icon={audio?.muted === false ? Pause : Play}
        label="Media"
        onClick={() => handleAction("media")}
        color="text-violet-400"
      />
      <ToggleButton
        icon={Sun}
        activeIcon={Moon}
        label="Theme"
        active={isDark}
        loading={pending === "dark"}
        onClick={() => handleAction("dark")}
        activeColor="text-amber-400"
      />
      <ToggleButton
        icon={WifiOff}
        activeIcon={Wifi}
        label="Wi-Fi"
        active={toggles?.wifi ?? false}
        loading={pending === "wifi"}
        onClick={() => handleToggle("wifi", !toggles?.wifi)}
      />
      <ToggleButton
        icon={VolumeX}
        activeIcon={Volume2}
        label="Mute"
        active={audio?.muted === false}
        loading={pending === "mute"}
        onClick={() => handleToggle("mute", !audio?.muted)}
        activeColor="text-sky-400"
      />
      <ToggleButton
        icon={BellOff}
        activeIcon={Bell}
        label="DND"
        active={toggles?.dnd ?? false}
        loading={pending === "dnd"}
        onClick={() => handleToggle("dnd", !toggles?.dnd)}
        activeColor="text-amber-400"
      />
    </div>
  )
}
