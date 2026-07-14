/* oxlint-disable jsx-a11y/control-has-associated-label */
import { useEffect, useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { ScrollText, LogIn, LogOut, FolderUp, FolderX, Pencil, Settings, AlertTriangle, X, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"
import { useAuditStore, type AuditEntry } from "@/lib/audit-store"
import { cn } from "@/lib/utils"

const EVENT_ICONS: Record<string, { icon: typeof LogIn; label: string; color: string }> = {
  login_success: { icon: LogIn, label: "Login Successful", color: "bg-emerald-500/10 text-emerald-500" },
  login_failed: { icon: LogOut, label: "Login Failed", color: "bg-destructive/10 text-destructive" },
  login_locked: { icon: LogOut, label: "Account Locked", color: "bg-destructive/15 text-destructive" },
  file_uploaded: { icon: FolderUp, label: "File Uploaded", color: "bg-sky-500/10 text-sky-500" },
  upload_failed: { icon: FolderX, label: "Upload Failed", color: "bg-destructive/10 text-destructive" },
  file_deleted: { icon: FolderX, label: "File Deleted", color: "bg-destructive/10 text-destructive" },
  file_renamed: { icon: Pencil, label: "File Renamed", color: "bg-amber-500/10 text-amber-500" },
  setup_complete: { icon: Settings, label: "Setup Complete", color: "bg-purple-500/10 text-purple-500" },
}

const EVENT_TYPES = [
  "",
  "login_success",
  "login_failed",
  "upload_failed",
  "login_locked",
  "file_uploaded",
  "file_deleted",
  "file_renamed",
  "setup_complete",
]

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function absoluteTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function FilterSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative flex-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 h-10 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-all appearance-none pr-8 font-semibold"
      >
        {children}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground text-xs font-bold font-mono">▼</span>
    </div>
  )
}

function FilterDate({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative flex-1">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 h-10 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-all pl-10"
        aria-label={label}
      />
      <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
    </div>
  )
}

export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const qs = searchParams.toString()
  const filters = useMemo(() => ({
    event: searchParams.get("event") || "",
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
  }), [qs]) // eslint-disable-line react-hooks/exhaustive-deps
  const {
    entries, nextCursor, hasMore, loading, error,
    setEntries, appendEntries, setLoading, setError,
  } = useAuditStore()

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchLogs(null, 50, filters.event, filters.from, filters.to)
      setEntries(data.entries, data.next_cursor, data.has_more)
    } catch {
      setError("Failed to load audit log")
    }
    setLoading(false)
  }, [filters, setEntries, setLoading, setError])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const handleLoadMore = async () => {
    if (!hasMore || loading || nextCursor == null) return
    setLoading(true)
    try {
      const data = await fetchLogs(nextCursor, 50, filters.event, filters.from, filters.to)
      appendEntries(data.entries, data.next_cursor, data.has_more)
    } catch {
      setError("Failed to load more entries")
    }
    setLoading(false)
  }

  const handleFilterChange = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    setSearchParams(next, { replace: true })
    fetchLogs(null, 50, key === "event" ? value : filters.event, key === "from" ? value : filters.from, key === "to" ? value : filters.to)
      .then((data) => setEntries(data.entries, data.next_cursor, data.has_more))
      .catch(() => setError("Failed to load audit log"))
  }

  return (
    <div className="space-y-4">
      {/* Filter panel */}
      <Card variant="glass" className="p-4 shadow-sm border border-border/40">
        <div className="flex flex-col sm:flex-row gap-3">
          <FilterSelect value={filters.event} onChange={(v) => handleFilterChange("event", v)}>
            <option value="">All Events</option>
            {EVENT_TYPES.filter(Boolean).map((ev) => (
              <option key={ev} value={ev}>{EVENT_ICONS[ev]?.label || ev}</option>
            ))}
          </FilterSelect>
          <FilterDate value={filters.from} onChange={(v) => handleFilterChange("from", v)} label="From Date" />
          <FilterDate value={filters.to} onChange={(v) => handleFilterChange("to", v)} label="To Date" />
          <Button variant="outline" className="h-10 rounded-xl font-semibold border-border/50 shrink-0" onClick={loadLogs} disabled={loading}>
            {loading ? "Syncing..." : "Apply Filters"}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="flex items-center justify-between rounded-xl bg-destructive/10 backdrop-blur-sm p-3.5 text-xs text-destructive border border-destructive/10 animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4.5 w-4.5 shrink-0" />
            <span className="font-semibold">{error}</span>
          </div>
          <button type="button" className="p-1 rounded hover:bg-destructive/10" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main logs display */}
      <div className="space-y-3">
        {loading && entries.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
        ) : entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border/40 rounded-3xl p-6 bg-muted/10">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
              <ScrollText className="w-6 h-6 text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No security entries</h3>
            <p className="text-xs text-muted-foreground max-w-xs leading-normal">No logs match the selected filter configuration.</p>
          </div>
        ) : (
          <>
            {/* Mobile Cards Layout (<md) */}
            <div className="md:hidden space-y-2.5">
              {entries.map((entry) => {
                const eventInfo = EVENT_ICONS[entry.event] || { icon: ScrollText, label: entry.event, color: "bg-muted text-muted-foreground" }
                const Icon = eventInfo.icon
                return (
                  <Card key={entry.id} variant="glass-shine" className="p-4 border-border/40 flex flex-col justify-between gap-2.5 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", eventInfo.color)}>
                          <Icon className="h-[17px] w-[17px]" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">{eventInfo.label}</p>
                          <p className="text-[10px] text-muted-foreground/75 mt-0.5" title={absoluteTime(entry.created_at)}>
                            {relativeTime(entry.created_at)}
                          </p>
                        </div>
                      </div>
                      
                      {entry.ip_address && (
                        <span className="text-[9px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border/40">
                          {entry.ip_address}
                        </span>
                      )}
                    </div>
                    {entry.details && (
                      <p className="text-[11px] text-muted-foreground leading-normal bg-muted/10 p-2.5 rounded-xl border border-border/10 font-medium">
                        {entry.details}
                      </p>
                    )}
                  </Card>
                )
              })}
            </div>

            {/* Desktop Table View (>=md) */}
            <Card variant="glass" className="hidden md:block overflow-hidden shadow-sm border border-border/40">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/20 text-xs font-semibold text-muted-foreground bg-muted/20">
                    <th className="text-left p-4 uppercase tracking-wider">Timestamp</th>
                    <th className="text-left p-4 uppercase tracking-wider">Event</th>
                    <th className="text-left p-4 uppercase tracking-wider">Details</th>
                    <th className="text-left p-4 uppercase tracking-wider">IP Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {entries.map((entry) => {
                    const eventInfo = EVENT_ICONS[entry.event] || { icon: ScrollText, label: entry.event, color: "bg-muted text-muted-foreground" }
                    const Icon = eventInfo.icon
                    return (
                      <tr key={entry.id} className="hover:bg-accent/30 transition-colors">
                        <td className="p-4 text-foreground/75 whitespace-nowrap text-xs" title={absoluteTime(entry.created_at)}>
                          {relativeTime(entry.created_at)}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2.5">
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", eventInfo.color)}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <span className="font-semibold text-xs text-foreground/90">{eventInfo.label}</span>
                          </div>
                        </td>
                        <td className="p-4 text-foreground/80 max-w-xs truncate text-xs font-medium">{entry.details || "—"}</td>
                        <td className="p-4 text-foreground/75 font-mono text-xs">{entry.ip_address || "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}

        {hasMore && entries.length > 0 && (
          <div className="p-4 flex items-center justify-between border border-border/10 rounded-2xl bg-card">
            <p className="text-xs font-semibold text-muted-foreground">Showing {entries.length} entries</p>
            <Button variant="outline" size="sm" className="rounded-xl h-9" onClick={handleLoadMore} disabled={loading}>
              {loading ? "Syncing..." : "Load More"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

async function fetchLogs(
  cursor: number | null,
  limit: number,
  event: string,
  from: string,
  to: string,
): Promise<{ entries: AuditEntry[]; next_cursor: number | null; has_more: boolean }> {
  const params = new URLSearchParams()
  if (cursor != null) params.set("cursor", String(cursor))
  params.set("limit", String(limit))
  if (event) params.set("event", event)
  if (from) params.set("from", String(Math.floor(new Date(from).getTime() / 1000)))
  if (to) params.set("to", String(Math.floor(new Date(to).getTime() / 1000)))
  const res = await fetch(`/api/audit/logs?${params}`)
  return res.json()
}
