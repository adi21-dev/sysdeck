import { useEffect, useCallback } from "react"
import { ScrollText, LogIn, LogOut, FolderUp, FolderX, Pencil, Settings, AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
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
    setEntries, appendEntries, setFilters, setLoading, setError, reset,
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
  }, [])

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
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">Audit Log</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Event</label>
          <select
            value={filters.event}
            onChange={(e) => handleFilterChange("event", e.target.value)}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">All Events</option>
            {EVENT_TYPES.filter(Boolean).map((ev) => (
              <option key={ev} value={ev}>
                {EVENT_ICONS[ev]?.label || ev}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => handleFilterChange("from", e.target.value)}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => handleFilterChange("to", e.target.value)}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={loadLogs}>
          Refresh
        </Button>
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

      {entries.length === 0 && !loading ? (
        <div className="py-16 text-center text-muted-foreground">
          No audit entries match your filters
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const eventInfo = EVENT_ICONS[entry.event] || { icon: ScrollText, label: entry.event }
            const Icon = eventInfo.icon
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-md border p-3 hover:bg-accent/50 transition-colors"
              >
                <div className="mt-0.5">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{eventInfo.label}</span>
                    {entry.event === "login_failed" && (
                      <Badge variant="destructive" className="text-[10px]">Failed</Badge>
                    )}
                  </div>
                  {entry.details && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.details}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground" title={absoluteTime(entry.created_at)}>
                    {relativeTime(entry.created_at)}
                  </p>
                  {entry.ip_address && (
                    <p className="text-[10px] text-muted-foreground">{entry.ip_address}</p>
                  )}
                </div>
              </div>
            )
          })}

          {hasMore && (
            <div className="text-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loading}>
                {loading ? "Loading..." : "Load More"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
