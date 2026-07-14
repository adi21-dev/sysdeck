import { useState, useEffect, useRef } from "react"
import { Grid3X3, Search, X, AppWindow } from "lucide-react"
import { useAppDeckStore } from "@/lib/store"
import { Button } from "@/components/ui/button"

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
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [open])

  const filtered = filter
    ? apps.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
    : apps

  if (!open) return null

  return (
    <>
      {/* Backdrop with fade-in */}
      <div
        className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-md animate-fade-in"
        onClick={onClose}
        role="presentation"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      />
      {/* Slide up sheet panel */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[201] max-h-[80dvh] rounded-t-[2rem] border-t border-border/40 flex flex-col bottom-sheet-panel overflow-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Drag indicator */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-border/60" />
        </div>

        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Library</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-9 w-9 rounded-xl hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="px-5 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search library..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-xl bg-background/50 border border-border/50 py-3 pl-10 pr-4 text-base md:text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
            {filtered.map((app) => (
              <button
                key={app.path}
                type="button"
                onClick={() => { onLaunch(app.path); onClose() }}
                className="flex flex-col items-center gap-2 rounded-2xl p-3 hover:bg-accent/60 transition-all duration-200 active:scale-90 press-effect"
              >
                <div className="w-12 h-12 rounded-2xl bg-muted/40 border border-border/20 flex items-center justify-center shadow-sm overflow-hidden flex-shrink-0">
                  <img
                    src={`/api/icon?path=${encodeURIComponent(app.path)}`}
                    alt={app.name}
                    className="w-10 h-10 object-contain rounded-xl"
                    loading="lazy"
                    onError={(e) => { 
                      const target = e.target as HTMLImageElement;
                      target.style.display = "none";
                      if (target.nextSibling) (target.nextSibling as HTMLElement).style.display = "flex";
                    }}
                  />
                  <div className="hidden w-10 h-10 items-center justify-center bg-primary/10 rounded-xl" style={{ display: "none" }}>
                    <AppWindow className="w-5 h-5 text-primary" />
                  </div>
                </div>
                <span className="text-[10px] text-center leading-tight font-medium text-foreground/80 line-clamp-2 max-w-[76px]">
                  {app.name}
                </span>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground/60 text-sm py-12">No apps match search criteria</p>
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
    if (navigator.vibrate) navigator.vibrate(10)
    try {
      await fetch("/api/windows/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hwnd }),
      })
    } catch { /* ignore */ }
  }

  const launchApp = async (path: string) => {
    if (navigator.vibrate) navigator.vibrate(10)
    try {
      await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      })
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-4">
        <h2 className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/80">Running Windows</h2>
        <Button
          type="button"
          variant="outline"
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-border/50 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors h-8"
        >
          <Grid3X3 className="h-3.5 w-3.5" />
          All Apps
        </Button>
      </div>

      {windows.length > 0 ? (
        <div className="flex overflow-x-auto gap-3.5 px-4 pb-3 snap-x scrollbar-thin">
          {windows.map((w) => (
            <button
              key={w.hwnd}
              type="button"
              onClick={() => focusWindow(w.hwnd)}
              className="flex flex-col items-center justify-between rounded-2xl border border-border/10 p-3 min-w-[84px] snap-start hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 active:scale-95 neu-control"
            >
              <div className="w-11 h-11 rounded-xl bg-muted/40 border border-border/20 flex items-center justify-center shadow-inner overflow-hidden mb-1">
                <img
                  src={`/api/icon?path=${encodeURIComponent(w.exe_path)}`}
                  alt=""
                  className="w-9 h-9 object-contain rounded-lg"
                  loading="lazy"
                  onError={(e) => { 
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                    if (target.nextSibling) (target.nextSibling as HTMLElement).style.display = "flex";
                  }}
                />
                <div className="hidden w-9 h-9 items-center justify-center bg-primary/10 rounded-lg" style={{ display: "none" }}>
                  <AppWindow className="w-4 h-4 text-primary" />
                </div>
              </div>
              <span className="text-[9px] font-semibold text-center leading-tight text-muted-foreground line-clamp-2 max-w-[74px]">
                {w.title}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 rounded-2xl border border-dashed border-border/40 bg-muted/10 mx-4 text-center">
          <p className="text-[11px] text-muted-foreground/60">
            No active desktop windows open
          </p>
        </div>
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
