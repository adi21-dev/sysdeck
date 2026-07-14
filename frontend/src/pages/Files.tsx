import { useEffect, useCallback, useState, useRef } from "react"
import { useSearchParams } from "react-router-dom"
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
import { InfoButton } from "@/components/ui/info-button"

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

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  if (!path) {
    return <span className="text-sm font-semibold">Home</span>
  }

  const parts = path.split("/").filter(Boolean)
  const crumbs = parts.map((part, i) => {
    const subPath = parts.slice(0, i + 1).join("/")
    return {
      label: part,
      partPath: path.startsWith("/") ? `/${subPath}` : subPath,
    }
  })

  return (
    <div className="flex items-center gap-1.5 text-xs md:text-sm overflow-x-auto whitespace-nowrap scrollbar-none pb-1 w-full max-w-full">
      <button 
        type="button"
        onClick={() => onNavigate("")} 
        className="text-muted-foreground hover:text-foreground transition-colors font-medium touch-target px-2 rounded-lg"
      >
        Home
      </button>
      {crumbs.map((cr, i) => (
        <span key={i} className="flex items-center gap-1.5 shrink-0">
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
          {i === crumbs.length - 1 ? (
            <span className="font-semibold text-foreground truncate max-w-[140px] md:max-w-[200px] px-1">{cr.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(cr.partPath)}
              className="text-muted-foreground hover:text-foreground transition-colors font-medium truncate max-w-[90px] md:max-w-[150px] touch-target px-2 rounded-lg"
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
  if (paths.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border/40 rounded-3xl p-6 bg-muted/10">
        <FolderOpen className="w-8 h-8 text-muted-foreground/50 mb-3" />
        <h3 className="text-sm font-semibold mb-1">No Allowed Paths Configured</h3>
        <p className="text-xs text-muted-foreground max-w-xs mb-4">You need to register folders in Settings before viewing files.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
      {paths.map((p) => {
        const full = fromApiPath(p)
        const parts = full.split("/").filter(Boolean)
        const short = parts[parts.length - 1] || full
        return (
          <button
            key={p}
            type="button"
            aria-label={`Open ${short}`}
            className="flex items-center gap-3.5 rounded-2xl border border-border/10 bg-card backdrop-blur-md p-4 text-left transition-all duration-200 hover:border-primary/20 hover:bg-accent/60 active:scale-[0.98] press-effect shadow-sm"
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(10)
              onNavigate(full)
            }}
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Folder className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{short}</p>
              <p className="text-[10px] text-muted-foreground/75 truncate mt-0.5">{p}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function FilesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentPath = searchParams.get("path") || IS_HOME
  const {
    entries,
    selected,
    viewMode,
    uploads,
    loading,
    error,
    allowedPaths,
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
          setEntries((data.entries || []).map((e: FileEntry) => ({ ...e, path: fromApiPath(e.path) })))
        } else {
          setError(data.error || "Failed to list directory")
        }
      } catch {
        setError("Network error")
      }
      setLoading(false)
    },
    [setEntries, setLoading, setError],
  )

  useEffect(() => {
    fetch("/api/settings/paths").then((r) => r.json()).then((d) => {
      if (d.success && d.allowed?.length > 0) {
        setAllowedPaths(d.allowed)
        if (!searchParams.has("path") && d.allowed.length === 1) {
          setSearchParams({ path: fromApiPath(d.allowed[0]) }, { replace: true })
        }
      } else {
        setAllowedPaths([])
        if (!searchParams.has("path")) {
          setError("No allowed paths configured. Go to Settings to add file access paths.")
        }
      }
    }).catch(() => setError("Failed to load allowed paths"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (currentPath !== IS_HOME) {
      loadDir(currentPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath])

  const handleNavigate = useCallback(
    (path: string) => {
      clearSelection()
      setSearchParams(path === IS_HOME ? {} : { path }, { replace: true })
      if (path === IS_HOME) {
        setEntries([])
      } else {
        loadDir(path)
      }
    },
    [loadDir, clearSelection, setSearchParams, setEntries],
  )

  const handleDoubleClick = (entry: FileEntry) => {
    if (entry.is_dir) handleNavigate(entry.path)
  }

  const sorted = [...entries].sort((a, b) => {
    const dirs = (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0)
    if (dirs !== 0) return -dirs
    return a.name.localeCompare(b.name)
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    
    // Support multiple files upload
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
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
    }
    
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
      if (data.success) { 
        useToastStore.getState().addToast("Deleted successfully", "success")
        clearSelection()
        loadDir(currentPath) 
      }
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
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(10)
      toggleSelected(path)
    }, 500)
  }
  
  const handleTouchEnd = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="flex flex-col gap-3">
        <Breadcrumb path={currentPath} onNavigate={handleNavigate} />
        
        {currentPath !== IS_HOME && (
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/20">
            <span className="text-xs text-muted-foreground font-mono">{entries.length} items</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setViewMode(viewMode === "table" ? "grid" : "table")}
                className="h-9 w-9 rounded-xl p-0"
                title={viewMode === "table" ? "Grid view" : "List view"}
              >
                {viewMode === "table" ? <Grid3X3 className="h-4 w-4" /> : <List className="h-4 w-4" />}
              </Button>
              
              <Button 
                type="button" 
                size="sm"
                className="h-9 rounded-xl font-semibold shadow-sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </Button>
              <InfoButton content={"Upload limit: 500 MB per file.\nSupports multiple files.\nIncomplete uploads are cleaned up."} className="ml-0.5" />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl bg-destructive/10 backdrop-blur-sm p-3.5 text-xs text-destructive border border-destructive/10 animate-fade-in">
          <span className="font-semibold">{error}</span>
          <button type="button" className="touch-target p-1 rounded hover:bg-destructive/10" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {currentPath === IS_HOME ? (
        <RootSelector paths={allowedPaths} onNavigate={handleNavigate} />
      ) : (
        <>
          {/* Uploads Indicator */}
          {uploads.length > 0 && (
            <Card variant="glass" className="p-4 space-y-3 shadow-md border border-border/40">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Uploading</h4>
              {uploads.map((u) => (
                <div key={u.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="truncate max-w-[220px]">{u.name}</span>
                    <span className="text-muted-foreground font-mono">{u.progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/65 overflow-hidden shadow-inner">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${u.progress}%` }} />
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Bulk Selection Indicator */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-accent/40 backdrop-blur-md border border-border/40 animate-fade-in">
              <span className="text-xs font-semibold text-foreground/80">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={clearSelection}>
                  Clear
                </Button>
                <Button variant="destructive" size="sm" className="h-8 rounded-lg text-xs font-semibold" onClick={handleBulkDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              </div>
            </div>
          )}

          {/* Core File Directory Display */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <span className="text-xs">Reading directory...</span>
            </div>
          ) : viewMode === "table" ? (
            /* Table View: responsive list cards for mobile (<md) & table for desktop (>=md) */
            <>
              {/* Mobile Card List (<md) */}
              <div className="md:hidden space-y-2">
                {sorted.map((entry) => {
                  const isSelected = selected.has(entry.path)
                  return (
                    <Card
                      key={entry.path}
                      variant="glass-shine"
                      onClick={() => toggleSelected(entry.path)}
                      onDoubleClick={() => handleDoubleClick(entry)}
                      onTouchStart={(e) => handleTouchStart(e, entry.path)}
                      onTouchEnd={handleTouchEnd}
                      className={cn(
                        "p-4 transition-all duration-200 border border-border/40 select-none",
                        isSelected && "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-md"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className="flex items-center gap-3 min-w-0 cursor-pointer"
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              if (entry.is_dir) {
                                e.stopPropagation()
                                handleNavigate(entry.path)
                              }
                            }
                          }}
                          onClick={(e) => {
                            // Allow double click or folder tap on icon to open
                            if (entry.is_dir) {
                              e.stopPropagation()
                              handleNavigate(entry.path)
                            }
                          }}
                        >
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                            entry.is_dir ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            {entry.is_dir ? <Folder className="w-5 h-5" /> : <File className="w-5 h-5" />}
                          </div>
                          
                          <div className="min-w-0">
                            {renaming === entry.path ? (
                              <Input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => e.key === "Enter" && commitRename()}
                                onClick={(e) => e.stopPropagation()}
                                className="h-8 text-sm"
                                // oxlint-disable-next-line jsx-a11y/no-autofocus
                                autoFocus
                              />
                            ) : (
                              <p className="text-sm font-semibold text-foreground truncate">{entry.name}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                              {entry.is_dir ? "Folder" : `${formatSize(entry.size)} • `}Modified {formatTime(entry.modified).split(",")[0]}
                            </p>
                          </div>
                        </div>
                        
                        {/* Actions (Always visible on mobile/touch, styled cleanly) */}
                        <div className="flex items-center gap-1 shrink-0">
                          {!entry.is_dir && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={(e) => { e.stopPropagation(); handleDownload(entry) }} aria-label="Download">
                              <Download className="w-4 h-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={(e) => { e.stopPropagation(); startRename(entry) }} aria-label="Rename">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); handleDelete(entry) }} aria-label="Delete">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>

              {/* Desktop Table View (>=md) */}
              <Card variant="glass" className="hidden md:block overflow-hidden shadow-sm border border-border/40">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/20 text-xs font-semibold text-muted-foreground bg-muted/20">
                      <th className="p-4 w-[1%]" aria-label="Select all">
                        <input
                          ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < entries.length }}
                          type="checkbox"
                          checked={entries.length > 0 && selected.size === entries.length}
                          onChange={() => {
                            if (selected.size === entries.length) clearSelection()
                            else entries.forEach((e) => { if (!selected.has(e.path)) toggleSelected(e.path) })
                          }}
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                      </th>
                      <th className="p-4 w-[1%]" aria-label="Type" />
                      <th className="p-4 w-full text-left">Name</th>
                      <th className="p-4 w-[1%]" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {sorted.map((entry) => (
                      <tr
                        key={entry.path}
                        className={cn(
                          "hover:bg-accent/40 transition-colors group cursor-pointer",
                          selected.has(entry.path) && "bg-accent/50",
                        )}
                        onClick={() => toggleSelected(entry.path)}
                        onDoubleClick={() => handleDoubleClick(entry)}
                      >
                        <td className="p-4 w-[1%] whitespace-nowrap align-middle" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${entry.name}`}
                            checked={selected.has(entry.path)}
                            onChange={() => toggleSelected(entry.path)}
                            className="h-4 w-4 rounded border-border accent-primary"
                          />
                        </td>
                        <td className="p-4 w-[1%] whitespace-nowrap align-middle">
                          {entry.is_dir ? (
                            <Folder className="w-5 h-5 text-primary" />
                          ) : (
                            <File className="w-5 h-5 text-muted-foreground/80" />
                          )}
                        </td>
                        <td className="p-4 w-full align-middle">
                          {renaming === entry.path ? (
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => e.key === "Enter" && commitRename()}
                              onClick={(e) => e.stopPropagation()}
                              className="h-8 text-sm max-w-md"
                              // oxlint-disable-next-line jsx-a11y/no-autofocus
                              autoFocus
                            />
                          ) : (
                            <p className="text-sm font-semibold text-foreground truncate max-w-xl">{entry.name}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/85">
                            {entry.is_dir ? "Folder" : `${formatSize(entry.size)} • `}Modified {formatTime(entry.modified)}
                          </p>
                        </td>
                        <td className="p-4 w-[1%] whitespace-nowrap align-middle opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex items-center gap-0.5">
                            {!entry.is_dir && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={(e) => { e.stopPropagation(); handleDownload(entry) }} title="Download">
                                <Download className="w-4 h-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={(e) => { e.stopPropagation(); startRename(entry) }} title="Rename">
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); handleDelete(entry) }} title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              
              {entries.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in border border-dashed border-border/40 rounded-3xl p-6 bg-muted/10">
                  <FolderOpen className="w-8 h-8 text-muted-foreground/50 mb-3" />
                  <h3 className="text-sm font-semibold mb-1">Folder is Empty</h3>
                  <p className="text-xs text-muted-foreground max-w-xs">Upload files or navigate elsewhere.</p>
                </div>
              )}
            </>
          ) : (
            /* Grid View */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
              {sorted.map((entry) => {
                const isSelected = selected.has(entry.path)
                return (
                  <button
                    key={entry.path}
                    type="button"
                    aria-label={`Open ${entry.name}`}
                    onKeyDown={(e) => { if (e.key === "Enter") handleDoubleClick(entry) }}
                    className={cn(
                      "glass-card flex flex-col items-center justify-center p-4 cursor-pointer hover:bg-accent/40 transition-all duration-200 gap-2.5 overflow-hidden group select-none h-32 relative text-left",
                      isSelected && "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-md",
                    )}
                    onDoubleClick={() => handleDoubleClick(entry)}
                    onTouchStart={(e) => handleTouchStart(e, entry.path)}
                    onTouchEnd={handleTouchEnd}
                    onClick={() => toggleSelected(entry.path)}
                  >
                    {/* Checkbox: always visible on mobile, visible on hover on desktop */}
                    <div className="absolute top-2.5 left-2.5 z-10">
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.name}`}
                        checked={isSelected}
                        onChange={() => toggleSelected(entry.path)}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "h-4 w-4 rounded border-border accent-primary transition-opacity",
                          "opacity-100 md:opacity-0 md:group-hover:opacity-100",
                          isSelected && "opacity-100"
                        )}
                      />
                    </div>
                    
                    {entry.is_dir ? (
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center relative">
                        <Folder className="h-5 w-5 text-primary" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center relative">
                        <File className="h-5 w-5 text-muted-foreground/80" />
                      </div>
                    )}
                    
                    <div className="text-center w-full min-w-0 px-1 mt-1">
                      <p className="text-xs font-semibold text-foreground truncate max-w-full leading-none">{entry.name}</p>
                      {!entry.is_dir && <p className="text-[10px] text-muted-foreground/80 mt-1 leading-none">{formatSize(entry.size)}</p>}
                    </div>
                  </button>
                )
              })}
              
              {entries.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-center animate-fade-in border border-dashed border-border/40 rounded-3xl p-6 bg-muted/10">
                  <FolderOpen className="w-8 h-8 text-muted-foreground/50 mb-3" />
                  <h3 className="text-sm font-semibold mb-1">Folder is Empty</h3>
                  <p className="text-xs text-muted-foreground max-w-xs">Upload files or navigate elsewhere.</p>
                </div>
              )}
            </div>
          )}

          {/* Floating Actions Input Trigger */}
          <input 
            ref={fileInputRef} 
            type="file" 
            className="hidden" 
            onChange={handleUpload} 
            multiple 
          />

          {/* Touch floating action button for quick upload */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-5 md:bottom-8 md:right-8 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg hover:opacity-95 active:scale-[0.93] transition-all duration-200 glow-primary font-bold"
            title="Upload files"
            aria-label="Upload files"
          >
            <Plus className="h-6 w-6" />
          </button>

          <ConfirmDialog 
            open={confirmDelete != null} 
            onOpenChange={() => setConfirmDelete(null)}
            title="Delete Item" 
            description={`Are you sure you want to delete "${confirmDelete?.name}"? This action cannot be undone.`}
            confirmText="DELETE" 
            actionLabel="Delete"
            onConfirm={() => { if (confirmDelete) doDelete(confirmDelete.path); setConfirmDelete(null) }}
          />

          <ConfirmDialog 
            open={confirmBulkDelete} 
            onOpenChange={() => setConfirmBulkDelete(false)}
            title="Delete Items" 
            description={`Are you sure you want to delete ${selected.size} selected item(s)? This action cannot be undone.`}
            confirmText="DELETE" 
            actionLabel="Delete All"
            onConfirm={() => { doBulkDelete(); setConfirmBulkDelete(false) }}
          />
        </>
      )}
    </div>
  )
}
