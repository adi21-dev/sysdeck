import { useEffect, useCallback, useState, useRef } from "react"
import {
  Download, Trash2, Pencil, RefreshCw,
  Table, Grid3X3, Folder, File, ChevronRight, Plus, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useFilesStore, type FileEntry } from "@/lib/files-store"

function toApiPath(p: string): string {
  return p.replace(/\//g, "\\")
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
  const parts = path.split("/").filter(Boolean)
  const crumbs = parts.map((part, i) => ({
    label: part,
    path: parts.slice(0, i + 1).join("/"),
  }))

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto whitespace-nowrap pb-1">
      <button onClick={() => onNavigate("/C:")} className="hover:text-foreground shrink-0">
        C:
      </button>
      {crumbs.map((cr, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 shrink-0" />
          {i === crumbs.length - 1 ? (
            <span className="text-foreground font-medium truncate max-w-[120px] md:max-w-[200px]">
              {cr.label}
            </span>
          ) : (
            <button
              onClick={() => onNavigate(cr.path)}
              className="hover:text-foreground truncate max-w-[80px] md:max-w-[150px]"
            >
              {cr.label}
            </button>
          )}
        </span>
      ))}
    </nav>
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
  } = useFilesStore()

  const [sortBy, setSortBy] = useState<"name" | "size" | "type" | "modified">("name")
  const [sortAsc, setSortAsc] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        const data = await listPath(path)
        if (data.success) {
          setCurrentPath(path)
          setEntries(data.entries || [])
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
    loadDir(currentPath)
  }, [])

  const handleNavigate = useCallback(
    (path: string) => {
      clearSelection()
      loadDir(path)
    },
    [loadDir, clearSelection],
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
    else {
      setSortBy(col)
      setSortAsc(true)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    addUpload({ name: file.name, progress: 0, status: "uploading" })
    const formData = new FormData()
    formData.append("file", file)
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        updateUpload(file.name, Math.round((ev.loaded / ev.total) * 100))
      }
    }
    xhr.onload = () => {
      removeUpload(file.name)
      loadDir(currentPath)
    }
    xhr.onerror = () => {
      updateUpload(file.name, 0)
      removeUpload(file.name)
      setError(`Upload failed: ${file.name}`)
    }
    xhr.open(
      "POST",
      `/api/files/upload?path=${encodeURIComponent(toApiPath(currentPath))}`,
    )
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
      a.href = url
      a.download = entry.name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(`Download failed: ${entry.name}`)
    }
  }

  const handleDelete = async (entry: FileEntry) => {
    if (!window.confirm(`Delete "${entry.name}"?`)) return
    try {
      const data = await deletePath(entry.path)
      if (data.success) {
        clearSelection()
        loadDir(currentPath)
      } else {
        setError(data.message || "Delete failed")
      }
    } catch {
      setError(`Delete failed: ${entry.name}`)
    }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Delete ${selected.size} item(s)?`)) return
    for (const p of selected) {
      try {
        await deletePath(p)
      } catch {
        setError(`Delete failed: ${p}`)
      }
    }
    clearSelection()
    loadDir(currentPath)
  }

  const startRename = (entry: FileEntry) => {
    setRenaming(entry.path)
    setRenameValue(entry.name)
  }

  const commitRename = async () => {
    if (!renaming || !renameValue.trim()) {
      setRenaming(null)
      return
    }
    const parts = renaming.split("/")
    parts[parts.length - 1] = renameValue.trim()
    const newPath = parts.join("/")
    try {
      const data = await renamePath(renaming, newPath)
      if (data.success) {
        clearSelection()
        loadDir(currentPath)
      } else {
        setError(data.message || "Rename failed")
      }
    } catch {
      setError("Rename failed")
    }
    setRenaming(null)
    setRenameValue("")
  }

  const handleTouchStart = (_e: React.TouchEvent, path: string) => {
    longPressTimer.current = setTimeout(() => {
      toggleSelected(path)
    }, 500)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }

  const sortIndicator = (col: typeof sortBy) => {
    if (sortBy !== col) return null
    return <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">File Manager</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setViewMode(viewMode === "table" ? "grid" : "table")} title="Toggle view">
            {viewMode === "table" ? <Grid3X3 className="h-4 w-4" /> : <Table className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Breadcrumb path={currentPath} onNavigate={handleNavigate} />

      {error && (
        <div className="flex items-center justify-between rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div key={u.name} className="flex items-center gap-3 text-sm">
              <span className="truncate max-w-[200px]">{u.name}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
              <span className="text-muted-foreground w-10 text-right">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-accent">
          <span className="text-sm text-muted-foreground mr-2">{selected.size} selected</span>
          <Button variant="outline" size="sm" onClick={handleBulkDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <Button variant="outline" size="sm" onClick={() => setViewMode(viewMode)} disabled>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      ) : viewMode === "table" ? (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-8 p-2 text-left">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) {
                        entries.forEach((en) => {
                          if (!en.is_dir) selected.add(en.path)
                        })
                        clearSelection()
                        entries.forEach((en) => {
                          if (!en.is_dir) toggleSelected(en.path)
                        })
                      } else clearSelection()
                    }}
                    className="accent-primary"
                  />
                </th>
                <th className="p-2 text-left cursor-pointer select-none" onClick={() => handleSort("name")}>
                  Name {sortIndicator("name")}
                </th>
                <th className="p-2 text-left cursor-pointer select-none hidden md:table-cell" onClick={() => handleSort("size")}>
                  Size {sortIndicator("size")}
                </th>
                <th className="p-2 text-left cursor-pointer select-none hidden sm:table-cell" onClick={() => handleSort("type")}>
                  Type {sortIndicator("type")}
                </th>
                <th className="p-2 text-left cursor-pointer select-none hidden lg:table-cell" onClick={() => handleSort("modified")}>
                  Modified {sortIndicator("modified")}
                </th>
                <th className="w-24 p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr
                  key={entry.path}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/30 cursor-pointer",
                    selected.has(entry.path) && "bg-accent",
                  )}
                  onDoubleClick={() => handleDoubleClick(entry)}
                  onTouchStart={(e) => handleTouchStart(e, entry.path)}
                  onTouchEnd={handleTouchEnd}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.path)}
                      onChange={() => toggleSelected(entry.path)}
                      className="accent-primary"
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {entry.is_dir ? (
                        <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                      ) : (
                        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      {renaming === entry.path ? (
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => e.key === "Enter" && commitRename()}
                          className="h-7 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="truncate max-w-[200px] md:max-w-[300px]">
                          {entry.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-muted-foreground hidden md:table-cell">
                    {entry.is_dir ? "—" : formatSize(entry.size)}
                  </td>
                  <td className="p-2 text-muted-foreground hidden sm:table-cell">
                    {entry.is_dir ? "Folder" : fileType(entry.name)}
                  </td>
                  <td className="p-2 text-muted-foreground hidden lg:table-cell">
                    {formatTime(entry.modified)}
                  </td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(entry)} title="Download">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startRename(entry)} title="Rename">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(entry)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    This folder is empty
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
                <Folder className="h-10 w-10 text-blue-500" />
              ) : (
                <File className="h-10 w-10 text-muted-foreground" />
              )}
              <span className="text-xs text-center truncate max-w-full">{entry.name}</span>
              {!entry.is_dir && (
                <span className="text-[10px] text-muted-foreground">{formatSize(entry.size)}</span>
              )}
            </Card>
          ))}
          {entries.length === 0 && (
            <div className="col-span-full py-16 text-center text-muted-foreground">
              This folder is empty
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        title="Upload file"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  )
}
