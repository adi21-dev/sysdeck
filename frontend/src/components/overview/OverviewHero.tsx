import { useClock } from "@/hooks/use-clock"
import { useConnectionStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const STATUS_LABELS: Record<string, string> = {
  connected: "System Online",
  disconnected: "Reconnecting…",
  offline: "Connection Lost",
}

export function OverviewHero() {
  const { hours, minutes, date } = useClock()
  const status = useConnectionStore((s) => s.status)

  const statusClass =
    status === "connected"    ? "status-connected" :
    status === "disconnected" ? "status-disconnected" :
    "status-offline"

  const statusDotColor =
    status === "connected"    ? "bg-green-500 shadow-[0_0_8px_hsl(142_65%_40%_/_0.6)]" :
    status === "disconnected" ? "bg-amber-400 shadow-[0_0_8px_hsl(38_90%_50%_/_0.6)]" :
    "bg-red-500 shadow-[0_0_8px_hsl(0_68%_48%_/_0.6)]"

  return (
    <div className="flex flex-col items-center pt-6 pb-2 text-center select-none">
      <div className="text-[4.5rem] md:text-[5.5rem] font-extrabold leading-none tracking-tight tabular-nums text-foreground drop-shadow-sm select-none">
        {hours}<span className="text-primary/75 animate-pulse inline-block mx-0.5">:</span>{minutes}
      </div>
      <div className="mt-2.5 text-xs md:text-sm font-semibold text-muted-foreground/80 tracking-wide">{date}</div>
      <div
        className={cn(
          "mt-4 flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-bold tracking-wider uppercase transition-colors",
          statusClass
        )}
      >
        <span className={cn("status-dot w-2 h-2 rounded-full", statusDotColor)} aria-hidden="true" />
        <span>{STATUS_LABELS[status] || "Unknown"}</span>
      </div>
    </div>
  )
}
