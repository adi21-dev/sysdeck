import { useMemo } from "react"
import { useClock } from "@/hooks/use-clock"
import { useTelemetryStore, useConnectionStore } from "@/lib/store"
import type { AmbientStage } from "@/hooks/use-ambient"

interface AmbientOverlayProps {
  stage: AmbientStage
  onWake: () => void
}

function microDrift() {
  const x = Math.round((Math.random() - 0.5) * 8)
  const y = Math.round((Math.random() - 0.5) * 8)
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
      } ${isAmbient ? "bg-black" : "bg-transparent"} cursor-default`}
      style={
        isAmbient
          ? { transform: `translate(${drift.x}px, ${drift.y}px)` }
          : undefined
      }
    >
      <div className={`transition-all duration-1000 ${
        isAmbient ? "opacity-25" : "opacity-90"
      }`}>
        <div className="flex flex-col items-center">
          <div className="text-[5rem] md:text-[7rem] font-bold leading-none tracking-tight tabular-nums">
            {hours}<span className="animate-pulse">:</span>{minutes}
          </div>
          <div className="mt-2 text-base md:text-lg text-foreground/60">{date}</div>
        </div>
      </div>

      <div className={`absolute bottom-12 flex items-center gap-3 transition-all duration-1000 ${
        isAmbient ? "opacity-15" : "opacity-40"
      }`}>
        {batteryPct != null && (
          <span className="text-xs tabular-nums">
            {batteryPct.toFixed(0)}%{batteryCharging ? " \u26A1" : ""}
          </span>
        )}
        <span className={`w-1.5 h-1.5 rounded-full ${
          status === "connected" ? "bg-green-500" :
          status === "disconnected" ? "bg-yellow-500" :
          "bg-red-500"
        }`} />
      </div>
    </button>
  )
}
