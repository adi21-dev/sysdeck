import { useEffect, useCallback, useState, useRef } from "react"
import {
  Download, Trash2, Pencil, RefreshCw,
  Grid3X3, List, Folder, File, ChevronRight, X, Upload, Plus, FolderOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useToastStore } from "@/lib/store"
import { useFilesStore, type FileEntry } from "@/lib/files-store"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"

function toApiPath(p: string): string {
  return p.replace(/^\/([A-Za-z]:)/, "$1\\").replace(/\//g, "\\")
}

function fromApiPath(p: string): string {
  const clean = p.replace(/^\\\\\?\\/, "")
  return clean.replace(/\\/g, "/").replace(/^([A-Za-z]:)/, "/$1")
}

function listPath(path: string): Promise<{ success: boolean; entries: FileEntry[]; path: string; error?: string }> {
  return fetch(`/api/files/list?path=${encodeURIComponent(toApiPath(path))}`).then((r) => r.json())
}

function deletePath(p: string): Promise<{ success: boolean; message: string }> {
  return fetch("/api/files/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: toApiPath(p) }),
  }).then((r) => r.json())
}

function renamePath(from: string, to: string): Promise<{ success: boolean; message: string }> {
  return fetch("/api/files/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: toApiPath(from), to: toApiPath(to) }),
  }).then((r) => r.json())
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "—"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function fileType(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot === -1) return "File"
  return name.slice(dot + 1).toUpperCase()
}

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  if (!path) {
    return <span className="text-sm font-medium">Home</span>
  }

  const parts = path.split("/").filter(Boolean)
  const crumbs = parts.map((part, i) => ({
    label: part,
    partPath: parts.slice(0, i + 1).join("/"),
  }))

  return (
    <div className="flex items-center gap-2 text-sm">
      <button onClick={() => onNavigate("")} className="text-muted-foreground hover:text-foreground transition-colors">
        Home
      </button>
      {crumbs.map((cr, i) => (
        <span key={i} className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          {i === crumbs.length - 1 ? (
            <span className="font-medium truncate max-w-[120px] md:max-w-[200px]">{cr.label}</span>
          ) : (
            <button
              onClick={() => onNavigate(cr.partPath)}
              className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[80px] md:max-w-[150px]"
            >
              {cr.label}
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

const IS_HOME = ""

function RootSelector({ paths, onNavigate }: { paths: string[]; onNavigate: (p: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {paths.map((p) => {
        const full = fromApiPath(p)
        const parts = full.split("/").filter(Boolean)
        const short = parts[parts.length - 1] || full
        return (
          <Card key={p} className="p-4 cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => onNavigate(full)}>
            <div className="flex items-center gap-3">
              <Folder className="h-8 w-8 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{short}</p>
                <p className="text-xs text-muted-foreground truncate">{p}</p>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export function FilesPage() {
  const {
    currentPath,
    entries,
    selected,
    viewMode,
    uploads,
    loading,
    error,
    allowedPaths,
    setCurrentPath,
    setEntries,
    setViewMode,
    toggleSelected,
    clearSelection,
    addUpload,
    updateUpload,
    removeUpload,
    setLoading,
    setError,
    setAllowedPaths,
  } = useFilesStore()

  const [sortBy, setSortBy] = useState<"name" | "size" | "type" | "modified">("name")
  const [sortAsc, setSortAsc] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<{ path: string; name: string } | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        const data = await listPath(path)
        if (data.success) {
          setCurrentPath(fromApiPath(data.path))
          setEntries((data.entries || []).map((e: FileEntry) => ({ ...e, path: fromApiPath(e.path) })))
        } else {
          setError(data.error || "Failed to list directory")
        }
      } catch {
        setError("Network error")
      }
      setLoading(false)
    },
    [setCurrentPath, setEntries, setLoading, setError],
  )

  useEffect(() => {
    fetch("/api/settings/paths").then((r) => r.json()).then((d) => {
      if (d.success && d.allowed?.length > 0) {
        const paths: string[] = d.allowed
        setAllowedPaths(paths)
        if (paths.length === 1) {
          const first = fromApiPath(paths[0])
          handleNavigate(first)
        }
      } else {
        setAllowedPaths([])
        setError("No allowed paths configured. Go to Settings to add file access paths.")
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (currentPath !== IS_HOME) {
      loadDir(currentPath)
    }
  }, [loadDir, currentPath])

  const handleNavigate = useCallback(
    (path: string) => {
      clearSelection()
      if (path === IS_HOME) {
        setCurrentPath(IS_HOME)
        setEntries([])
      } else {
        loadDir(path)
      }
    },
    [loadDir, clearSelection, setCurrentPath, setEntries],
  )

  const handleRefresh = () => loadDir(currentPath)

  const handleDoubleClick = (entry: FileEntry) => {
    if (entry.is_dir) handleNavigate(entry.path)
  }

  const sorted = [...entries].sort((a, b) => {
    const dirs = (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0)
    if (dirs !== 0) return dirs * (sortAsc ? -1 : 1)
    let cmp = 0
    if (sortBy === "name") cmp = a.name.localeCompare(b.name)
    else if (sortBy === "size") cmp = a.size - b.size
    else if (sortBy === "type") cmp = fileType(a.name).localeCompare(fileType(b.name))
    else if (sortBy === "modified") cmp = a.modified - b.modified
    return sortAsc ? cmp : -cmp
  })

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc)
    else { setSortBy(col); setSortAsc(true) }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    addUpload({ name: file.name, progress: 0, status: "uploading" })
    const formData = new FormData()
    formData.append("file", file)
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) updateUpload(file.name, Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => { removeUpload(file.name); loadDir(currentPath) }
    xhr.onerror = () => {
      updateUpload(file.name, 0); removeUpload(file.name); setError(`Upload failed: ${file.name}`)
    }
    xhr.open("POST", `/api/files/upload?path=${encodeURIComponent(toApiPath(currentPath))}`)
    xhr.send(formData)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleDownload = async (entry: FileEntry) => {
    if (entry.is_dir) return
    try {
      const res = await fetch(`/api/files/download?path=${encodeURIComponent(toApiPath(entry.path))}`)
      if (!res.ok) throw new Error("Download failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = entry.name; a.click()
      URL.revokeObjectURL(url)
    } catch { setError(`Download failed: ${entry.name}`) }
  }

  const handleDelete = (entry: FileEntry) => setConfirmDelete({ path: entry.path, name: entry.name })

  const doDelete = async (path: string) => {
    try {
      const data = await deletePath(path)
      if (data.success) { useToastStore.getState().addToast("Deleted successfully", "success"); clearSelection(); loadDir(currentPath) }
      else setError(data.message || "Delete failed")
    } catch { setError("Delete failed") }
  }

  const handleBulkDelete = () => { if (selected.size > 0) setConfirmBulkDelete(true) }

  const doBulkDelete = async () => {
    for (const p of selected) { try { await deletePath(p) } catch { setError(`Delete failed: ${p}`) } }
    useToastStore.getState().addToast(`Deleted ${selected.size} item(s)`, "success")
    clearSelection(); loadDir(currentPath)
  }

  const startRename = (entry: FileEntry) => { setRenaming(entry.path); setRenameValue(entry.name) }

  const commitRename = async () => {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return }
    const parts = renaming.split("/")
    parts[parts.length - 1] = renameValue.trim()
    const newPath = parts.join("/")
    try {
      const data = await renamePath(renaming, newPath)
      if (data.success) { clearSelection(); loadDir(currentPath) }
      else setError(data.message || "Rename failed")
    } catch { setError("Rename failed") }
    setRenaming(null); setRenameValue("")
  }

  const handleTouchStart = (_e: React.TouchEvent, path: string) => {
    longPressTimer.current = setTimeout(() => toggleSelected(path), 500)
  }
  const handleTouchEnd = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }

  const sortIndicator = (col: typeof sortBy) => {
    if (sortBy !== col) return null
    return <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Breadcrumb path={currentPath} onNavigate={handleNavigate} />
        {currentPath !== IS_HOME && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === "table" ? "grid" : "table")}
              className="p-2 rounded-lg border bg-background hover:bg-accent transition-colors"
              title={viewMode === "table" ? "Grid view" : "List view"}
            >
              {viewMode === "table" ? <Grid3X3 className="h-4 w-4" /> : <List className="h-4 w-4" />}
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {currentPath === IS_HOME && allowedPaths.length > 0 ? (
        <RootSelector paths={allowedPaths} onNavigate={handleNavigate} />
      ) : currentPath === IS_HOME ? null : (
        <>
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div key={u.name} className="flex items-center gap-3 text-sm">
              <span className="truncate max-w-[200px]">{u.name}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${u.progress}%` }} />
              </div>
              <span className="text-muted-foreground w-10 text-right">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-accent">
          <span className="text-sm text-muted-foreground mr-2">{selected.size} selected</span>
          <Button variant="outline" size="sm" onClick={handleBulkDelete}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      ) : viewMode === "table" ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="divide-y">
            {sorted.map((entry) => (
              <div
                key={entry.path}
                className={cn(
                  "flex items-center gap-3 p-4 hover:bg-accent/50 transition-colors group cursor-pointer",
                  selected.has(entry.path) && "bg-accent",
                )}
                onDoubleClick={() => handleDoubleClick(entry)}
                onTouchStart={(e) => handleTouchStart(e, entry.path)}
                onTouchEnd={handleTouchEnd}
              >
                {entry.is_dir ? (
                  <Folder className="w-5 h-5 text-primary shrink-0" />
                ) : (
                  <File className="w-5 h-5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {renaming === entry.path ? (
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => e.key === "Enter" && commitRename()}
                      className="h-7 text-sm"
                    />
                  ) : (
                    <p className="text-sm font-medium truncate">{entry.name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {entry.is_dir ? "Folder" : `${formatSize(entry.size)} • `}Modified {formatTime(entry.modified)}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!entry.is_dir && (
                    <button className="p-1.5 rounded hover:bg-accent" onClick={() => handleDownload(entry)} title="Download">
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <button className="p-1.5 rounded hover:bg-accent" onClick={() => startRename(entry)} title="Rename">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 rounded hover:bg-accent" onClick={() => handleDelete(entry)} title="Delete">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                </div>
              </div>
            ))}
            {entries.length === 0 && (
              <EmptyState icon={FolderOpen} title="This folder is empty" description="Upload files or navigate to another directory" />
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {sorted.map((entry) => (
            <Card
              key={entry.path}
              className={cn(
                "flex flex-col items-center justify-center p-4 cursor-pointer hover:bg-accent/50 transition-colors gap-2",
                selected.has(entry.path) && "ring-2 ring-primary",
              )}
              onDoubleClick={() => handleDoubleClick(entry)}
              onTouchStart={(e) => handleTouchStart(e, entry.path)}
              onTouchEnd={handleTouchEnd}
              onClick={() => toggleSelected(entry.path)}
            >
              {entry.is_dir ? (
                <Folder className="h-10 w-10 text-primary" />
              ) : (
                <File className="h-10 w-10 text-muted-foreground" />
              )}
              <span className="text-xs text-center truncate max-w-full">{entry.name}</span>
              {!entry.is_dir && <span className="text-[10px] text-muted-foreground">{formatSize(entry.size)}</span>}
            </Card>
          ))}
          {entries.length === 0 && (
            <div className="col-span-full">
              <EmptyState icon={FolderOpen} title="This folder is empty" description="Upload files or navigate to another directory" />
            </div>
          )}
        </div>
      )}

      <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        title="Upload file"
      >
        <Plus className="h-5 w-5" />
      </button>

      <ConfirmDialog open={confirmDelete != null} onOpenChange={() => setConfirmDelete(null)}
        title="Delete file" description={`Are you sure you want to delete "${confirmDelete?.name}"? This action cannot be undone.`}
        confirmText="DELETE" actionLabel="Delete"
        onConfirm={() => { if (confirmDelete) doDelete(confirmDelete.path); setConfirmDelete(null) }}
      />

      <ConfirmDialog open={confirmBulkDelete} onOpenChange={() => setConfirmBulkDelete(false)}
        title="Delete multiple files" description={`Are you sure you want to delete ${selected.size} item(s)? This action cannot be undone.`}
        confirmText="DELETE" actionLabel="Delete All"
        onConfirm={() => { doBulkDelete(); setConfirmBulkDelete(false) }}
      />
        </>)}
    </div>
  )
}
