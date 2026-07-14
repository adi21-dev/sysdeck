import { useState } from "react"
import { Wifi, WifiOff, Volume2, VolumeX, Bell, BellOff, MonitorOff, Lock, Play, Pause, Sun, Moon, Loader2 } from "lucide-react"
import { useHardwareStore, useThemeStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface ToggleButtonProps {
  icon: React.ElementType
  activeIcon: React.ElementType
  label: string
  active: boolean
  loading?: boolean
  onClick: () => void
  activeColorClass?: string
  glowColorClass?: string
  className?: string
}

function ToggleButton({
  icon: Icon,
  activeIcon: ActiveIcon,
  label,
  active,
  loading,
  onClick,
  activeColorClass = "text-primary bg-primary/8 border-primary/20",
  glowColorClass = "glow-primary",
  className,
}: ToggleButtonProps) {
  const IconComp = active ? ActiveIcon : Icon
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-2xl h-[76px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none relative overflow-hidden",
        active
          ? cn("neu-inset", activeColorClass, glowColorClass)
          : "neu-control border border-border/10 text-muted-foreground hover:text-foreground",
        loading && "opacity-60 cursor-not-allowed",
        className
      )}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <IconComp className="h-5 w-5" />
      )}
      <span className="text-[9px] font-bold uppercase tracking-widest leading-none mt-1">{label}</span>
      <span className="text-[8px] font-medium opacity-65 leading-none mt-0.5">{active ? "Active" : "Ready"}</span>
    </button>
  )
}

interface ActionButtonProps {
  icon: React.ElementType
  label: string
  onClick: () => void
  colorClass?: string
  loading?: boolean
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  colorClass = "text-primary",
  loading,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-2xl h-[76px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none",
        "neu-control border border-border/10 text-muted-foreground hover:text-foreground",
        loading && "opacity-60 cursor-not-allowed"
      )}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <Icon className={cn("h-5 w-5", colorClass)} />
      )}
      <span className="text-[9px] font-bold uppercase tracking-widest leading-none mt-1">{label}</span>
      <span className="text-[8px] font-medium opacity-50 leading-none mt-0.5">Trigger</span>
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
    if (navigator.vibrate) navigator.vibrate(10)
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
    if (navigator.vibrate) navigator.vibrate(10)
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
    <div className="space-y-3">
      <div className="px-4">
        <h2 className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/80">Quick Panel</h2>
      </div>
      
      {/* 2-column or 4-column responsive toggles using custom CSS class toggle-grid */}
      <div className="toggle-grid px-4">
        <ActionButton
          icon={MonitorOff}
          label="Monitor"
          onClick={() => handleAction("monitor")}
          colorClass="text-sky-400 dark:text-sky-400"
          loading={pending === "monitor"}
        />
        <ActionButton
          icon={Lock}
          label="Lock PC"
          onClick={() => handleAction("lock")}
          colorClass="text-rose-400 dark:text-rose-400"
          loading={pending === "lock"}
        />
        <ActionButton
          icon={audio?.muted === false ? Pause : Play}
          label="Media"
          onClick={() => handleAction("media")}
          colorClass="text-violet-400 dark:text-violet-400"
          loading={pending === "media"}
        />
        <ToggleButton
          icon={Sun}
          activeIcon={Moon}
          label="Theme"
          active={isDark}
          loading={pending === "dark"}
          onClick={() => handleAction("dark")}
          activeColorClass="text-amber-500 bg-amber-500/5 dark:bg-amber-500/5 border-amber-500/10"
          glowColorClass="glow-warm"
        />
        <ToggleButton
          icon={WifiOff}
          activeIcon={Wifi}
          label="Wi-Fi"
          active={toggles?.wifi ?? false}
          loading={pending === "wifi"}
          onClick={() => handleToggle("wifi", !toggles?.wifi)}
          activeColorClass="text-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/5 border-emerald-500/10"
          glowColorClass="glow-primary"
        />
        <ToggleButton
          icon={VolumeX}
          activeIcon={Volume2}
          label="Sound"
          active={audio?.muted === false}
          loading={pending === "mute"}
          onClick={() => handleToggle("mute", !audio?.muted)}
          activeColorClass="text-sky-500 bg-sky-500/5 dark:bg-sky-500/5 border-sky-500/10"
          glowColorClass="glow-blue"
        />
        <ToggleButton
          icon={BellOff}
          activeIcon={Bell}
          label="Do Not Disturb"
          active={toggles?.dnd ?? false}
          loading={pending === "dnd"}
          onClick={() => handleToggle("dnd", !toggles?.dnd)}
          activeColorClass="text-purple-500 bg-purple-500/5 dark:bg-purple-500/5 border-purple-500/10"
          glowColorClass="glow-primary"
          className="col-span-1"
        />
      </div>
    </div>
  )
}
