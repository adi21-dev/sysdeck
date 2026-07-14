import { useState, useEffect, useRef } from "react"
import { Grid3X3, Search, X } from "lucide-react"
import { useAppDeckStore } from "@/lib/store"

interface AppInfo {
  name: string
  path: string
}

function AllAppsDrawer({
  open,
  onClose,
  apps,
  onLaunch,
}: {
  open: boolean
  onClose: () => void
  apps: AppInfo[]
  onLaunch: (path: string) => void
}) {
  const [filter, setFilter] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFilter("")
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const filtered = filter
    ? apps.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
    : apps

  if (!open) return null

  return (
    <>
        <div
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            role="presentation"
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
      <div
        className="fixed bottom-0 left-0 right-0 z-[201] max-h-[85dvh] rounded-t-3xl bg-zinc-950 border-t border-zinc-800 flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold">All Apps</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search apps..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-xl bg-zinc-900 border border-zinc-800 py-2.5 pl-10 pr-4 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          <div className="grid grid-cols-4 gap-3">
            {filtered.map((app) => (
              <button
                key={app.path}
                type="button"
                onClick={() => { onLaunch(app.path); onClose() }}
                className="flex flex-col items-center gap-2 rounded-2xl p-3 hover:bg-zinc-900 transition-colors active:scale-95"
              >
                <img
                  src={`/api/icon?path=${encodeURIComponent(app.path)}`}
                  alt={app.name}
                  className="w-10 h-10 rounded-xl"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                />
                <span className="text-[10px] text-center leading-tight text-zinc-400 line-clamp-2">
                  {app.name}
                </span>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-zinc-600 text-sm py-8">No apps match your search</p>
          )}
        </div>
      </div>
    </>
  )
}

export function AppDeck() {
  const windows = useAppDeckStore((s) => s.windows)
  const [apps, setApps] = useState<AppInfo[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const fetchApps = async () => {
      try {
        const res = await fetch("/api/apps")
        const json = await res.json()
        if (json.success) setApps(json.apps)
      } catch { /* ignore */ }
    }
    fetchApps()
  }, [])

  const focusWindow = async (hwnd: number) => {
    navigator.vibrate?.(10)
    try {
      await fetch("/api/windows/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hwnd }),
      })
    } catch { /* ignore */ }
  }

  const launchApp = async (path: string) => {
    navigator.vibrate?.(10)
    try {
      await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      })
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Running Apps</h2>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Grid3X3 className="h-3.5 w-3.5" />
          All Apps
        </button>
      </div>

      {windows.length > 0 ? (
        <div className="flex overflow-x-auto gap-3 px-4 pb-2 snap-x">
          {windows.map((w) => (
            <button
              key={w.hwnd}
              type="button"
              onClick={() => focusWindow(w.hwnd)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-border/50 p-3 min-w-[80px] snap-start hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 active:scale-95"
            >
              <img
                src={`/api/icon?path=${encodeURIComponent(w.exe_path)}`}
                alt=""
                className="w-9 h-9 rounded-lg"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
              />
              <span className="text-[10px] text-center leading-tight text-muted-foreground line-clamp-2 max-w-[72px]">
                {w.title}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground/50 px-4">
          No windows open
        </p>
      )}

      <AllAppsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        apps={apps}
        onLaunch={launchApp}
      />
    </div>
  )
}
