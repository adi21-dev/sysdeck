import { useEffect, useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { ScrollText, LogIn, LogOut, FolderUp, FolderX, Pencil, Settings, AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuditStore, type AuditEntry } from "@/lib/audit-store"

const EVENT_ICONS: Record<string, { icon: typeof LogIn; label: string }> = {
  login_success: { icon: LogIn, label: "Login Successful" },
  login_failed: { icon: LogOut, label: "Login Failed" },
  login_locked: { icon: LogOut, label: "Account Locked" },
  file_uploaded: { icon: FolderUp, label: "File Uploaded" },
  upload_failed: { icon: FolderX, label: "Upload Failed" },
  file_deleted: { icon: FolderX, label: "File Deleted" },
  file_renamed: { icon: Pencil, label: "File Renamed" },
  setup_complete: { icon: Settings, label: "Setup Complete" },
}

const EVENT_TYPES = [
  "",
  "login_success",
  "login_failed",
  "upload_failed",
  "login_locked",
  "file_uploaded",
  "upload_failed",
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 px-3 py-2.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all appearance-none"
    >
      {children}
    </select>
  )
}

function FilterDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 px-3 py-2.5 rounded-xl border border-input bg-background/50 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
    />
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
      <div className="glass-card p-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        <div className="flex flex-col sm:flex-row gap-3">
          <FilterSelect value={filters.event} onChange={(v) => handleFilterChange("event", v)}>
            <option value="">All Events</option>
            {EVENT_TYPES.filter(Boolean).map((ev) => (
              <option key={ev} value={ev}>{EVENT_ICONS[ev]?.label || ev}</option>
            ))}
          </FilterSelect>
          <FilterDate value={filters.from} onChange={(v) => handleFilterChange("from", v)} />
          <FilterDate value={filters.to} onChange={(v) => handleFilterChange("to", v)} />
          <Button variant="outline" onClick={loadLogs} disabled={loading}>
            {loading ? "Loading..." : "Apply Filters"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl bg-destructive/10 backdrop-blur-sm saturate-[1.4] p-3 text-sm text-destructive border border-destructive/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none dark:from-white/5" />
        {loading && entries.length === 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Timestamp</th>
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Event</th>
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Details</th>
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-48" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-28" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : entries.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <ScrollText className="w-7 h-7 text-muted-foreground/60" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No audit entries found</h3>
            <p className="text-sm text-muted-foreground max-w-xs">No entries match your current filters. Try adjusting the event type or date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Timestamp</th>
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Event</th>
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">Details</th>
                  <th className="text-left p-4 font-medium text-muted-foreground text-xs uppercase tracking-wider">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {entries.map((entry) => {
                  const eventInfo = EVENT_ICONS[entry.event] || { icon: ScrollText, label: entry.event }
                  const Icon = eventInfo.icon
                  return (
                    <tr key={entry.id} className="hover:bg-accent/30 transition-colors">
                      <td className="p-4 text-foreground/70 whitespace-nowrap text-xs" title={absoluteTime(entry.created_at)}>
                        {relativeTime(entry.created_at)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-foreground/70 shrink-0" />
                          <span className="font-medium">{eventInfo.label}</span>
                        </div>
                      </td>
                      <td className="p-4 text-foreground/70 max-w-xs truncate text-sm">{entry.details || "—"}</td>
                      <td className="p-4 text-foreground/70 font-mono text-xs">{entry.ip_address || "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && entries.length > 0 && (
          <div className="p-4 border-t border-border/30 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Showing {entries.length} entries</p>
            <Button variant="outline" onClick={handleLoadMore} disabled={loading}>
              {loading ? "Loading..." : "Load More"}
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
