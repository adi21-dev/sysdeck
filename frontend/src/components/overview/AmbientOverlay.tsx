import { useMemo } from "react"
import { useClock } from "@/hooks/use-clock"
import { useTelemetryStore, useConnectionStore } from "@/lib/store"
import type { AmbientStage } from "@/hooks/use-ambient"

interface AmbientOverlayProps {
  stage: AmbientStage
  onWake: () => void
}

function microDrift() {
  const x = Math.round((Math.random() - 0.5) * 10)
  const y = Math.round((Math.random() - 0.5) * 10)
  return { x, y }
}

export function AmbientOverlay({ stage, onWake }: AmbientOverlayProps) {
  const { hours, minutes, date } = useClock()
  const batteryPct = useTelemetryStore((s) => s.current?.battery_percent ?? null)
  const batteryCharging = useTelemetryStore((s) => s.current?.battery_charging ?? null)
  const status = useConnectionStore((s) => s.status)
  const drift = useMemo(() => (stage === "ambient" ? microDrift() : { x: 0, y: 0 }), [stage])

  const visible = stage === "simplified" || stage === "ambient"
  const isAmbient = stage === "ambient"

  return (
    <button
      type="button"
      onClick={onWake}
      onPointerDown={onWake}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-all duration-1000 ${
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      } ${isAmbient ? "bg-black" : "bg-background/90 backdrop-blur-2xl"} cursor-default select-none`}
      style={
        isAmbient
          ? { transform: `translate(${drift.x}px, ${drift.y}px)` }
          : undefined
      }
    >
      <div className={`transition-all duration-1000 ${
        isAmbient ? "opacity-20" : "opacity-95"
      }`}>
        <div className="flex flex-col items-center text-center">
          <div className="text-[5.5rem] md:text-[7.5rem] font-extrabold leading-none tracking-tighter tabular-nums text-foreground">
            {hours}<span className="text-primary/70 animate-pulse inline-block mx-0.5">:</span>{minutes}
          </div>
          <div className="mt-4 text-sm md:text-base font-semibold text-muted-foreground/85 tracking-wide">{date}</div>
        </div>
      </div>

      <div className={`absolute bottom-12 flex items-center gap-3 transition-all duration-1000 ${
        isAmbient ? "opacity-10" : "opacity-50"
      }`}>
        {batteryPct != null && (
          <span className="text-[11px] font-mono tracking-wider tabular-nums font-semibold">
            {batteryPct.toFixed(0)}%{batteryCharging ? " \u26A1" : ""}
          </span>
        )}
        <span className={`w-2 h-2 rounded-full ${
          status === "connected" ? "bg-green-500 shadow-[0_0_8px_hsl(142_65%_40%/0.5)]" :
          status === "disconnected" ? "bg-amber-400 shadow-[0_0_8px_hsl(38_90%_50%/0.5)]" :
          "bg-red-500 shadow-[0_0_8px_hsl(0_68%_48%/0.5)]"
        }`} />
      </div>
    </button>
  )
}
