import { useEffect, useCallback } from "react"
import { ScrollText, LogIn, LogOut, FolderUp, FolderX, Pencil, Settings, AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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

export function AuditPage() {
  const {
    entries, nextCursor, hasMore, filters, loading, error,
    setEntries, appendEntries, setFilters, setLoading, setError,
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
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    fetchLogs(null, 50, newFilters.event, newFilters.from, newFilters.to)
      .then((data) => setEntries(data.entries, data.next_cursor, data.has_more))
      .catch(() => setError("Failed to load audit log"))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={filters.event}
            onChange={(e) => handleFilterChange("event", e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="">All Events</option>
            {EVENT_TYPES.filter(Boolean).map((ev) => (
              <option key={ev} value={ev}>{EVENT_ICONS[ev]?.label || ev}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => handleFilterChange("from", e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => handleFilterChange("to", e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          <Button variant="outline" onClick={loadLogs} disabled={loading}>
            {loading ? "Loading..." : "Apply Filters"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        {entries.length === 0 && !loading ? (
          <div className="py-16 text-center text-muted-foreground">No audit entries match your filters</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium">Timestamp</th>
                  <th className="text-left p-4 font-medium">Event</th>
                  <th className="text-left p-4 font-medium">Details</th>
                  <th className="text-left p-4 font-medium">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((entry) => {
                  const eventInfo = EVENT_ICONS[entry.event] || { icon: ScrollText, label: entry.event }
                  const Icon = eventInfo.icon
                  return (
                    <tr key={entry.id} className="hover:bg-accent/50 transition-colors cursor-pointer">
                      <td className="p-4 text-muted-foreground whitespace-nowrap" title={absoluteTime(entry.created_at)}>
                        {relativeTime(entry.created_at)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{eventInfo.label}</span>
                        </div>
                      </td>
                      <td className="p-4 text-muted-foreground max-w-xs truncate">{entry.details || "—"}</td>
                      <td className="p-4 text-muted-foreground font-mono text-xs">{entry.ip_address || "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && entries.length > 0 && (
          <div className="p-4 border-t flex items-center justify-between">
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
