import { useMemo } from "react"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts"
import { useTelemetryStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function DashboardPage() {
  const current = useTelemetryStore((s) => s.current)
  const history = useTelemetryStore((s) => s.history)

  const chartData = useMemo(() => {
    const source = history.length > 60 ? history.slice(-60) : history
    return source.map((t) => ({
      time: new Date(t.timestamp).toLocaleTimeString(),
      cpu: t.cpu_usage,
      ram: +((t.ram_used / t.ram_total) * 100).toFixed(1),
      rx: +(t.net_rx_bps / 1024 / 1024).toFixed(2),
      tx: +(t.net_tx_bps / 1024 / 1024).toFixed(2),
      battery: t.battery_percent ?? null,
    }))
  }, [history])

  const cpu = current?.cpu_usage?.toFixed(1) ?? null
  const ramPct = current ? +((current.ram_used / current.ram_total) * 100).toFixed(1) : null
  const ramUsed = current ? formatBytes(current.ram_used) : null
  const ramTotal = current ? formatBytes(current.ram_total) : null
  const temp = current?.temperature ?? null
  const diskUsed = current ? formatBytes(current.disk_used) : null
  const diskTotal = current ? formatBytes(current.disk_total) : null
  const diskPct = current ? +((current.disk_used / current.disk_total) * 100).toFixed(0) : null
  const rx = current ? formatBytes(current.net_rx_bps) + "/s" : null
  const tx = current ? formatBytes(current.net_tx_bps) + "/s" : null
  const batteryPct = current?.battery_percent ?? null
  const batteryCharging = current?.battery_charging ?? null

  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Metric Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">CPU</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{cpu ?? "—"}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">RAM</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{ramPct != null ? `${ramPct}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">{ramUsed ?? "—"} / {ramTotal ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Temperature</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{temp != null ? `${temp.toFixed(0)}°C` : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Disk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{diskPct != null ? `${diskPct}%` : "—"}</p>
            <p className="text-xs text-muted-foreground">{diskUsed ?? "—"} / {diskTotal ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Network</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>↓ {rx ?? "—"}</p>
            <p>↑ {tx ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Battery</CardTitle>
          </CardHeader>
          <CardContent>
            {batteryPct != null ? (
              <p className={`text-2xl font-bold ${batteryCharging ? "text-yellow-500" : batteryPct < 20 ? "text-red-500" : "text-green-500"}`}>
                {batteryCharging ? "⚡ " : ""}{batteryPct.toFixed(0)}%
              </p>
            ) : (
              <p className="text-2xl font-bold">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">CPU & RAM</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" className="text-xs text-muted-foreground" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} className="text-xs text-muted-foreground" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="cpu" stroke="#22c55e" fill="url(#cpuGrad)" name="CPU %" dot={false} />
                  <Area type="monotone" dataKey="ram" stroke="#3b82f6" fill="url(#ramGrad)" name="RAM %" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Network I/O</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" className="text-xs text-muted-foreground" tick={{ fontSize: 10 }} />
                  <YAxis className="text-xs text-muted-foreground" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="rx" stroke="#22c55e" fill="url(#rxGrad)" name="Down (MB/s)" dot={false} />
                  <Area type="monotone" dataKey="tx" stroke="#f59e0b" fill="url(#txGrad)" name="Up (MB/s)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Battery</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="batGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="time" className="text-xs text-muted-foreground" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} className="text-xs text-muted-foreground" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="battery" stroke="#eab308" fill="url(#batGrad)" name="Battery %" dot={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
