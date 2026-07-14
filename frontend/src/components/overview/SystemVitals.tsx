import { useTelemetryStore } from "@/lib/store"
import { RadialGauge } from "./RadialGauge"

export function SystemVitals() {
  const current = useTelemetryStore((s) => s.current)

  const cpu = current?.cpu_usage ?? 0
  const ram = current?.ram_total ? (current.ram_used / current.ram_total) * 100 : 0
  const disk = current?.disk_total ? (current.disk_used / current.disk_total) * 100 : 0
  const temp = current?.temperature_cpu ?? null

  return (
    <div className="grid grid-cols-4 gap-2 px-2">
      <RadialGauge value={cpu} label="CPU" color="hsl(173 80% 45%)" />
      <RadialGauge value={ram} label="RAM" color="hsl(210 80% 55%)" />
      <RadialGauge value={disk} label="Disk" color="hsl(40 90% 55%)" />
      <RadialGauge
        value={temp ?? 0}
        max={100}
        label="Temp"
        unit="°C"
        color={temp !== null && temp > 80 ? "hsl(0 80% 55%)" : "hsl(280 60% 60%)"}
      />
    </div>
  )
}
