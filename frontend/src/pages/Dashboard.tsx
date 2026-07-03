import { useMemo, useState, useEffect } from "react"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts"
import { Cpu, MemoryStick, Thermometer, HardDrive, Activity, BatteryCharging, Zap, ArrowDown, ArrowUp } from "lucide-react"
import { useTelemetryStore } from "@/lib/store"
import { Button } from "@/components/ui/button"

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
      .catch(() => {})
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
      cpu: t.cpu_usage,
      ram: +((t.ram_used / t.ram_total) * 100).toFixed(1),
      rx: +(t.net_rx_bps / 1024 / 1024).toFixed(2),
      tx: +(t.net_tx_bps / 1024 / 1024).toFixed(2),
      battery: t.battery_percent ?? null,
      temperature_cpu: t.temperature_cpu ?? null,
      temperature_gpu: t.temperature_gpu ?? null,
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
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button key={r.value} size="sm" variant={range === r.value ? "default" : "outline"} onClick={() => setRange(r.value)} disabled={loadingHistory}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">CPU Usage</span>
            </div>
            <span className="text-2xl font-bold">{cpu ?? "—"}%</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MemoryStick className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Memory</span>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold">{ramUsed?.split(" ")[0] ?? "—"}</span>
              <span className="text-sm text-muted-foreground">/{ramTotal ?? "—"}</span>
            </div>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div className="bg-primary h-2 rounded-full" style={{ width: `${ramPct ?? 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{ramPct != null ? `${ramPct}% used` : "—"}</p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Thermometer className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Temperature</span>
          </div>
          <div className="flex justify-between">
            <div>
              <span className="text-xs text-muted-foreground">CPU</span>
              <p className="text-xl font-bold">{tempCpu != null ? `${tempCpu.toFixed(0)}°C` : "—"}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">GPU</span>
              <p className="text-xl font-bold">{tempGpu != null ? `${tempGpu.toFixed(0)}°C` : "—"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Disk Usage</span>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold">{diskUsed?.split(" ")[0] ?? "—"}</span>
              <span className="text-sm text-muted-foreground">/{diskTotal ?? "—"}</span>
            </div>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div className="bg-primary h-2 rounded-full" style={{ width: `${diskPct ?? 0}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{diskPct != null ? `${diskPct}% used` : "—"}</p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Network</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <ArrowDown className="w-3 h-3" /> Download
              </span>
              <span className="font-medium">{rx ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <ArrowUp className="w-3 h-3" /> Upload
              </span>
              <span className="font-medium">{tx ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <BatteryCharging className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Battery</span>
            </div>
            <span className="text-2xl font-bold">{batteryPct != null ? `${batteryPct.toFixed(0)}%` : "—"}</span>
          </div>
          {batteryPct != null && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className={`w-3 h-3 ${batteryCharging ? "text-green-500" : "text-muted-foreground"}`} />
              {batteryCharging ? "Charging" : "Discharging"}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4">CPU & RAM Usage</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(221.2 83.2% 53.3%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(221.2 83.2% 53.3%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" stroke="var(--border)" />
                <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <YAxis domain={[0, 100]} className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }} />
                <Area type="monotone" dataKey="cpu" stroke="hsl(221.2 83.2% 53.3%)" fill="url(#cpuGrad)" name="CPU %" dot={false} strokeWidth={2} />
                <Area type="monotone" dataKey="ram" stroke="hsl(142.1 76.2% 36.3%)" fill="url(#ramGrad)" name="RAM %" dot={false} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4">Network I/O</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(142.1 76.2% 36.3%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(221.2 83.2% 53.3%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(221.2 83.2% 53.3%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" stroke="var(--border)" />
                <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <YAxis className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }} />
                <Area type="monotone" dataKey="rx" stroke="hsl(142.1 76.2% 36.3%)" fill="url(#rxGrad)" name="Down (MB/s)" dot={false} strokeWidth={2} />
                <Area type="monotone" dataKey="tx" stroke="hsl(221.2 83.2% 53.3%)" fill="url(#txGrad)" name="Up (MB/s)" dot={false} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4">Battery</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="batGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(40 100% 50%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(40 100% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" stroke="var(--border)" />
                <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <YAxis domain={[0, 100]} className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }} />
                <Area type="monotone" dataKey="battery" stroke="hsl(40 100% 50%)" fill="url(#batGrad)" name="Battery %" dot={false} connectNulls strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4">Temperature</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="tempCpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0 100% 50%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(0 100% 50%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tempGpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(200 100% 50%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(200 100% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" stroke="var(--border)" />
                <XAxis dataKey="time" className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <YAxis domain={['auto', 'auto']} className="text-xs" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--muted-foreground)" />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }} />
                <Area type="monotone" dataKey="temperature_cpu" stroke="hsl(0 100% 50%)" fill="url(#tempCpuGrad)" name="CPU (°C)" dot={false} connectNulls strokeWidth={2} />
                <Area type="monotone" dataKey="temperature_gpu" stroke="hsl(200 100% 50%)" fill="url(#tempGpuGrad)" name="GPU (°C)" dot={false} connectNulls strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
