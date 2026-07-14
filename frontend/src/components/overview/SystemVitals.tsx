import { useTelemetryStore } from "@/lib/store"
import { RadialGauge } from "./RadialGauge"

export function SystemVitals() {
  const current = useTelemetryStore((s) => s.current)

  const cpu = current?.cpu_usage ?? 0
  const ram = current?.ram_total ? (current.ram_used / current.ram_total) * 100 : 0
  const disk = current?.disk_total ? (current.disk_used / current.disk_total) * 100 : 0
  const temp = current?.temperature_cpu ?? null

  return (
    <div className="grid grid-cols-4 gap-2 w-full max-w-lg mx-auto">
      <RadialGauge value={cpu} label="CPU" color="var(--chart-1)" size={80} strokeWidth={5} />
      <RadialGauge value={ram} label="RAM" color="var(--chart-2)" size={80} strokeWidth={5} />
      <RadialGauge value={disk} label="Disk" color="var(--chart-3)" size={80} strokeWidth={5} />
      <RadialGauge
        value={temp ?? 0}
        max={100}
        label="Temp"
        unit="°"
        color={temp !== null && temp > 75 ? "var(--destructive)" : "var(--chart-4)"}
        size={80}
        strokeWidth={5}
      />
    </div>
  )
}
