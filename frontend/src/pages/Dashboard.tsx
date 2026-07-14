import { useMemo, useState, useEffect, memo } from "react"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts"
import { Cpu, MemoryStick, Thermometer, HardDrive, Activity, BatteryCharging, Zap, ArrowDown, ArrowUp, Gauge, Loader2 } from "lucide-react"
import { useTelemetryStore, useToastStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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

interface StatCardProps {
  icon: any
  label: string
  children: React.ReactNode
  className?: string
}

const StatCard = memo(function StatCard({ icon: Icon, label, children, className }: StatCardProps) {
  return (
    <Card variant="glass-shine" className={cn("hover:border-border/70 hover:-translate-y-0.5 hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full p-5", className)}>
      <div className="flex items-center justify-between mb-3 relative z-10 flex-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-end relative z-10">{children}</div>
      </div>
    </Card>
  )
})

function GradientArea({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.20} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card variant="glass" className="p-5 hover:border-border/70 transition-all duration-300 hover:shadow-md">
      <h3 className="text-sm font-semibold mb-4 text-muted-foreground relative z-10">{title}</h3>
      <div className="h-60 md:h-64 relative z-10">
        {children}
      </div>
    </Card>
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border/50 bg-background/90 backdrop-blur-xl px-4 py-3 shadow-lg text-xs leading-normal">
      <p className="text-muted-foreground font-mono mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mt-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground">{p.name}:</span>
          <span className="font-semibold">{p.value}{p.name.includes("°C") ? "°C" : p.name.includes("Battery") ? "%" : ""}</span>
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
      time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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

  const isDataAvailable = !loadingHistory && (current || chartData.length > 0)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Telemetry</h1>
            <p className="text-xs md:text-sm text-muted-foreground">Real-time system telemetry and performance charts</p>
          </div>
        </div>
        
        {/* Interval Select pills */}
        <div className="flex gap-0.5 bg-muted/60 backdrop-blur-sm p-0.5 rounded-xl border border-border/30">
          {RANGES.map((r) => (
            <Button
              key={r.value}
              size="sm"
              variant={range === r.value ? "default" : "ghost"}
              onClick={() => setRange(r.value)}
              disabled={loadingHistory}
              className="rounded-lg text-xs h-8 px-3"
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {!isDataAvailable ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-5 ring-1 ring-primary/10">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Waiting for telemetry data</h2>
          <p className="text-xs text-muted-foreground max-w-xs">
            Connecting to system sensors and compiling metrics. This should only take a moment.
          </p>
        </div>
      ) : (
        <>
          {/* Stat Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 stagger-children">
            <StatCard icon={Cpu} label="CPU Usage">
              <span className="text-xl md:text-2xl font-bold tracking-tight">{cpu ?? "—"}<span className="text-xs text-muted-foreground font-normal ml-0.5">%</span></span>
            </StatCard>

            <StatCard icon={MemoryStick} label="Memory">
              <div className="text-right">
                <span className="text-xl md:text-2xl font-bold tracking-tight">{ramUsed?.split(" ")[0] ?? "—"}</span>
                <span className="text-[10px] text-muted-foreground ml-0.5">/{ramTotal ?? "—"}</span>
              </div>
            </StatCard>

            <StatCard icon={HardDrive} label="Disk Usage">
              <div className="text-right">
                <span className="text-xl md:text-2xl font-bold tracking-tight">{diskUsed?.split(" ")[0] ?? "—"}</span>
                <span className="text-[10px] text-muted-foreground ml-0.5">/{diskTotal ?? "—"}</span>
              </div>
            </StatCard>

            <StatCard icon={Thermometer} label="Temperature">
              <div className="flex gap-3">
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground block leading-none mb-1">CPU</span>
                  <p className="text-base md:text-lg font-bold">{tempCpu != null ? `${tempCpu.toFixed(0)}°` : "—"}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground block leading-none mb-1">GPU</span>
                  <p className="text-base md:text-lg font-bold">{tempGpu != null ? `${tempGpu.toFixed(0)}°` : "—"}</p>
                </div>
              </div>
            </StatCard>

            <StatCard icon={Activity} label="Network">
              <div className="space-y-0.5 min-w-[80px] text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground inline-flex items-center"><ArrowDown className="w-2.5 h-2.5 mr-0.5 text-success" /></span>
                  <span className="font-semibold font-mono truncate max-w-[65px]">{rx?.replace("/s", "") ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground inline-flex items-center"><ArrowUp className="w-2.5 h-2.5 mr-0.5 text-primary" /></span>
                  <span className="font-semibold font-mono truncate max-w-[65px]">{tx?.replace("/s", "") ?? "—"}</span>
                </div>
              </div>
            </StatCard>

            <StatCard icon={BatteryCharging} label="Battery">
              <div className="text-right">
                <span className="text-xl md:text-2xl font-bold tracking-tight">{batteryPct != null ? `${batteryPct.toFixed(0)}%` : "—"}</span>
                {batteryPct != null && (
                  <p className="text-[9px] text-muted-foreground flex items-center gap-0.5 justify-end mt-1">
                    <Zap className={`w-2.5 h-2.5 ${batteryCharging ? "text-success animate-pulse" : ""}`} />
                    {batteryCharging ? "Charging" : "Discharging"}
                  </p>
                )}
              </div>
            </StatCard>
          </div>

          {/* Progress Meters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ramPct != null && (
              <Card variant="glass" className="p-5 overflow-hidden">
                <div className="flex items-center justify-between mb-3 relative z-10">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Memory Allocation</span>
                  <span className="text-sm font-bold font-mono">{ramPct}%</span>
                </div>
                <div className="w-full bg-muted/65 rounded-full h-2.5 overflow-hidden relative z-10 shadow-inner">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-700 shadow-[0_0_8px_hsl(173_75%_38%_/_0.5)]"
                    style={{ width: `${ramPct}%` }}
                  />
                </div>
              </Card>
            )}

            {diskPct != null && (
              <Card variant="glass" className="p-5 overflow-hidden">
                <div className="flex items-center justify-between mb-3 relative z-10">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Storage Capacity</span>
                  <span className="text-sm font-bold font-mono">{diskPct}%</span>
                </div>
                <div className="w-full bg-muted/65 rounded-full h-2.5 overflow-hidden relative z-10 shadow-inner">
                  <div
                    className="bg-chart-3 h-full rounded-full transition-all duration-700 shadow-[0_0_8px_hsl(40_90%_50%_/_0.5)]"
                    style={{ width: `${diskPct}%` }}
                  />
                </div>
              </Card>
            )}
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="CPU & RAM Usage (%)">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <GradientArea id="cpuGrad" color="var(--chart-1)" />
                    <GradientArea id="ramGrad" color="var(--chart-2)" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
                  <XAxis dataKey="time" className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <YAxis domain={[0, 100]} className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="cpu" stroke="var(--chart-1)" fill="url(#cpuGrad)" name="CPU Usage" dot={false} strokeWidth={2.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="ram" stroke="var(--chart-2)" fill="url(#ramGrad)" name="RAM Usage" dot={false} strokeWidth={2.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Network Throughput (MB/s)">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <GradientArea id="rxGrad" color="var(--chart-1)" />
                    <GradientArea id="txGrad" color="var(--chart-2)" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
                  <XAxis dataKey="time" className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <YAxis className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="rx" stroke="var(--chart-1)" fill="url(#rxGrad)" name="Download" dot={false} strokeWidth={2.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="tx" stroke="var(--chart-2)" fill="url(#txGrad)" name="Upload" dot={false} strokeWidth={2.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Battery Level (%)">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <GradientArea id="batGrad" color="var(--chart-3)" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
                  <XAxis dataKey="time" className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <YAxis domain={[0, 100]} className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="battery" stroke="var(--chart-3)" fill="url(#batGrad)" name="Battery" dot={false} connectNulls strokeWidth={2.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Component Temperatures (°C)">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <GradientArea id="tempCpuGrad" color="var(--chart-5)" />
                    <GradientArea id="tempGpuGrad" color="var(--chart-2)" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" vertical={false} />
                  <XAxis dataKey="time" className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <YAxis domain={['auto', 'auto']} className="text-[10px] font-mono" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="temperature_cpu" stroke="var(--chart-5)" fill="url(#tempCpuGrad)" name="CPU Temp" dot={false} connectNulls strokeWidth={2.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="temperature_gpu" stroke="var(--chart-2)" fill="url(#tempGpuGrad)" name="GPU Temp" dot={false} connectNulls strokeWidth={2.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}
