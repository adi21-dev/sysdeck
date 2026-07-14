import { useMemo, useState, useEffect, memo } from "react"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts"
import { Cpu, MemoryStick, Thermometer, HardDrive, Activity, BatteryCharging, Zap, ArrowDown, ArrowUp, Gauge, Loader2 } from "lucide-react"
import { useTelemetryStore, useToastStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

const RANGES = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
]

const StatCard = memo(function StatCard({ icon: Icon, label, children, className }: { icon: any; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass-card p-5 hover:border-border/80 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg h-full flex flex-col", className)}>
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
      <div className="flex items-center justify-between mb-4 relative flex-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-end">{children}</div>
      </div>
    </div>
  )
})

function GradientArea({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.25} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5 hover:border-border/80 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg h-full">
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
      <h3 className="text-sm font-semibold mb-4 text-muted-foreground relative">{title}</h3>
      <div className="h-64 relative">
        {children}
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border/50 bg-background/80 backdrop-blur-xl px-4 py-3 shadow-lg text-sm">
      <p className="text-muted-foreground mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground">{p.name}:</span>
          <span className="font-medium">{p.value}{p.name.includes("°C") ? "°C" : p.name.includes("Battery") ? "%" : ""}</span>
        </div>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const current = useTelemetryStore((s) => s.current)
  const liveHistory = useTelemetryStore((s) => s.history)
  const [historical, setHistorical] = useState<any[]>([])
  const [range, setRange] = useState("1h")
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    setLoadingHistory(true)
    fetch(`/api/telemetry/history?range=${range}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setHistorical(data)
      })
      .catch(() => useToastStore.getState().addToast("Failed to load history", "error"))
      .finally(() => setLoadingHistory(false))
  }, [range])

  const chartData = useMemo(() => {
    const count = range === "1h" ? 60 : range === "6h" ? 180 : range === "24h" ? 300 : 1000
    const seen = new Set<number>()
    const merged = [...historical, ...liveHistory]
      .filter((t) => {
        if (seen.has(t.timestamp)) return false
        seen.add(t.timestamp)
        return true
      })
      .sort((a, b) => a.timestamp - b.timestamp)
    const source = merged.length > count ? merged.slice(-count) : merged
    return source.map((t: any) => ({
      time: new Date(t.timestamp).toLocaleTimeString(),
      cpu: t.cpu_usage != null ? +t.cpu_usage.toFixed(1) : null,
      ram: +((t.ram_used / t.ram_total) * 100).toFixed(1),
      rx: +(t.net_rx_bps / 1024 / 1024).toFixed(2),
      tx: +(t.net_tx_bps / 1024 / 1024).toFixed(2),
      battery: t.battery_percent ?? null,
      temperature_cpu: t.temperature_cpu != null ? +t.temperature_cpu.toFixed(1) : null,
      temperature_gpu: t.temperature_gpu != null ? +t.temperature_gpu.toFixed(1) : null,
    }))
  }, [historical, liveHistory, range])

  const cpu = current?.cpu_usage?.toFixed(1) ?? null
  const ramPct = current ? +((current.ram_used / current.ram_total) * 100).toFixed(1) : null
  const ramUsed = current ? formatBytes(current.ram_used) : null
  const ramTotal = current ? formatBytes(current.ram_total) : null
  const tempCpu = current?.temperature_cpu ?? null
  const tempGpu = current?.temperature_gpu ?? null
  const diskUsed = current ? formatBytes(current.disk_used) : null
  const diskTotal = current ? formatBytes(current.disk_total) : null
  const diskPct = current ? +((current.disk_used / current.disk_total) * 100).toFixed(0) : null
  const rx = current ? formatBytes(current.net_rx_bps) + "/s" : null
  const tx = current ? formatBytes(current.net_tx_bps) + "/s" : null
  const batteryPct = current?.battery_percent ?? null
  const batteryCharging = current?.battery_charging ?? null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Real-time system telemetry</p>
          </div>
        </div>
        <div className="flex gap-1 bg-muted/50 backdrop-blur-sm p-1 rounded-xl border border-border/30">
          {RANGES.map((r) => (
            <Button key={r.value} size="sm" variant={range === r.value ? "default" : "ghost"} onClick={() => setRange(r.value)} disabled={loadingHistory} className="rounded-lg">
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {!loadingHistory && !current && chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in-up">
          <div className="w-20 h-20 rounded-3xl bg-primary/5 flex items-center justify-center mb-6 ring-1 ring-primary/10">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
          </div>
          <h2 className="text-xl font-semibold mb-2">Waiting for telemetry data</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Collecting first system metrics. This usually takes a few seconds after connecting.
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 staggered-children">
        <StatCard icon={Cpu} label="CPU Usage">
          <span className="text-2xl font-bold tracking-tight">{cpu ?? "—"}<span className="text-sm text-muted-foreground font-normal">%</span></span>
        </StatCard>

        <StatCard icon={MemoryStick} label="Memory">
          <div className="text-right">
            <span className="text-2xl font-bold tracking-tight">{ramUsed?.split(" ")[0] ?? "—"}</span>
            <span className="text-sm text-muted-foreground">/{ramTotal ?? "—"}</span>
          </div>
        </StatCard>

        <StatCard icon={HardDrive} label="Disk Usage">
          <div className="text-right">
            <span className="text-2xl font-bold tracking-tight">{diskUsed?.split(" ")[0] ?? "—"}</span>
            <span className="text-sm text-muted-foreground">/{diskTotal ?? "—"}</span>
          </div>
        </StatCard>

        <StatCard icon={Thermometer} label="Temperature">
          <div className="flex gap-4">
            <div className="text-right">
              <span className="text-xs text-muted-foreground">CPU</span>
              <p className="text-xl font-bold">{tempCpu != null ? `${tempCpu.toFixed(0)}°` : "—"}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">GPU</span>
              <p className="text-xl font-bold">{tempGpu != null ? `${tempGpu.toFixed(0)}°` : "—"}</p>
            </div>
          </div>
        </StatCard>

        <StatCard icon={Activity} label="Network">
          <div className="space-y-1 min-w-[100px]">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1"><ArrowDown className="w-3 h-3" /></span>
              <span className="font-medium tabular-nums">{rx ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1"><ArrowUp className="w-3 h-3" /></span>
              <span className="font-medium tabular-nums">{tx ?? "—"}</span>
            </div>
          </div>
        </StatCard>

        <StatCard icon={BatteryCharging} label="Battery">
          <div className="text-right">
            <span className="text-2xl font-bold tracking-tight">{batteryPct != null ? `${batteryPct.toFixed(0)}%` : "—"}</span>
            {batteryPct != null && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end mt-0.5">
                <Zap className={`w-3 h-3 ${batteryCharging ? "text-green-400" : ""}`} />
                {batteryCharging ? "Charging" : "Discharging"}
              </p>
            )}
          </div>
        </StatCard>
      </div>
      )}

      {ramPct != null && (
        <div className="glass-card p-5 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div className="flex items-center justify-between mb-3 relative">
            <span className="text-sm font-medium text-muted-foreground">Memory Usage</span>
            <span className="text-sm font-medium tabular-nums">{ramPct}%</span>
          </div>
          <div className="w-full bg-muted/50 rounded-full h-2 overflow-hidden relative">
            <div className="bg-primary h-2 rounded-full transition-all duration-500 shadow-[0_0_6px_hsl(173_80%_30%_/_0.4)]" style={{ width: `${ramPct}%` }} />
          </div>
        </div>
      )}

      {diskPct != null && (
        <div className="glass-card p-5 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
          <div className="flex items-center justify-between mb-3 relative">
            <span className="text-sm font-medium text-muted-foreground">Disk Usage</span>
            <span className="text-sm font-medium tabular-nums">{diskPct}%</span>
          </div>
          <div className="w-full bg-muted/50 rounded-full h-2 overflow-hidden relative">
            <div className="bg-chart-3 h-2 rounded-full transition-all duration-500 shadow-[0_0_6px_hsl(40_90%_50%_/_0.4)]" style={{ width: `${diskPct}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="CPU & RAM Usage">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <GradientArea id="cpuGrad" color="var(--chart-1)" />
                <GradientArea id="ramGrad" color="var(--chart-2)" />
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <YAxis domain={[0, 100]} className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="cpu" stroke="var(--chart-1)" fill="url(#cpuGrad)" name="CPU %" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="ram" stroke="var(--chart-2)" fill="url(#ramGrad)" name="RAM %" dot={false} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Network I/O">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <GradientArea id="rxGrad" color="var(--chart-1)" />
                <GradientArea id="txGrad" color="var(--chart-2)" />
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <YAxis className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="rx" stroke="var(--chart-1)" fill="url(#rxGrad)" name="Down (MB/s)" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="tx" stroke="var(--chart-2)" fill="url(#txGrad)" name="Up (MB/s)" dot={false} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Battery">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <GradientArea id="batGrad" color="var(--chart-3)" />
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <YAxis domain={[0, 100]} className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="battery" stroke="var(--chart-3)" fill="url(#batGrad)" name="Battery %" dot={false} connectNulls strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Temperature">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <GradientArea id="tempCpuGrad" color="var(--chart-5)" />
                <GradientArea id="tempGpuGrad" color="var(--chart-2)" />
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <YAxis domain={['auto', 'auto']} className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="temperature_cpu" stroke="var(--chart-5)" fill="url(#tempCpuGrad)" name="CPU (°C)" dot={false} connectNulls strokeWidth={2} isAnimationActive={false} />
              <Area type="monotone" dataKey="temperature_gpu" stroke="var(--chart-2)" fill="url(#tempGpuGrad)" name="GPU (°C)" dot={false} connectNulls strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}
