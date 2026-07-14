import { useClock } from "@/hooks/use-clock"
import { useConnectionStore } from "@/lib/store"

const STATUS_LABELS: Record<string, string> = {
  connected: "System Online",
  disconnected: "Reconnecting…",
  offline: "Connection Lost",
}

const BREATHE = { animation: "breathe 4s ease-in-out infinite" }

export function OverviewHero() {
  const { hours, minutes, date } = useClock()
  const status = useConnectionStore((s) => s.status)

  return (
    <div className="flex flex-col items-center pt-8">
      <div className="text-[4rem] md:text-[5rem] font-bold leading-none tracking-tight tabular-nums">
        {hours}<span className="text-primary/50" style={BREATHE}>:</span>{minutes}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{date}</div>
      <div className="mt-3 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          status === "connected" ? "bg-green-500 shadow-[0_0_8px_hsl(120_100%_50%/0.5)]" :
          status === "disconnected" ? "bg-yellow-500 shadow-[0_0_8px_hsl(50_100%_50%/0.5)]" :
          "bg-red-500 shadow-[0_0_8px_hsl(0_100%_50%/0.5)]"
        }`} />
        <span className="text-xs text-muted-foreground">{STATUS_LABELS[status] || "Unknown"}</span>
      </div>
    </div>
  )
}
