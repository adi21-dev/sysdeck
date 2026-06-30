import { useTelemetryStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function DashboardPage() {
  const current = useTelemetryStore((s) => s.current)

  const cpu = current?.cpu_usage?.toFixed(1) ?? "—"
  const ramUsed = current ? (current.ram_used / 1024 ** 3).toFixed(1) : "—"
  const ramTotal = current ? (current.ram_total / 1024 ** 3).toFixed(1) : "—"
  const temp = current?.temperature?.toFixed(0) ?? "—"
  const diskUsed = current ? (current.disk_used / 1024 ** 3).toFixed(1) : "—"
  const diskTotal = current ? (current.disk_total / 1024 ** 3).toFixed(1) : "—"
  const rx = current ? (current.net_rx_bps / 1024).toFixed(0) : "—"
  const tx = current ? (current.net_tx_bps / 1024).toFixed(0) : "—"

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">CPU</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{cpu}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">RAM</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{ramUsed}GB</p>
            <p className="text-xs text-muted-foreground">of {ramTotal}GB</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Temperature</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{temp}°C</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Disk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{diskUsed}GB</p>
            <p className="text-xs text-muted-foreground">of {diskTotal}GB</p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Network</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">↓ {rx} KB/s</p>
            <p className="text-sm">↑ {tx} KB/s</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Battery</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {current?.battery_percent != null
                ? `${current.battery_percent.toFixed(0)}% ${current.battery_charging ? "(charging)" : ""}`
                : "N/A"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
