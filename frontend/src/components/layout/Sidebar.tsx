import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { Monitor, Moon, Sun, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { navItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore, useThemeStore } from "@/lib/store"
import { useState, useEffect } from "react"

export function Sidebar() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const { toggle } = useThemeStore()
  const items = isLocal ? [...navItems, ...adminNavItems] : navItems
  const location = useLocation()
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-full w-60 flex-col border-r border-border/40 bg-sidebar-background backdrop-blur-xl z-50">
      <div className="flex items-center gap-3 p-6 border-b border-border/30">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Monitor className="w-5 h-5 text-primary" />
        </div>
        <span className="font-semibold text-lg tracking-tight">SysDeck</span>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const isActive = location.pathname === item.to
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                isActive
                  ? "bg-primary/10 text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.08)] backdrop-blur-sm"
                  : "text-sidebar-foreground hover:text-foreground hover:bg-accent/50 hover:shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.04)] hover:backdrop-blur-sm"
              )}
            >
              <item.icon className={cn("h-4 w-4 transition-colors", isActive && "text-primary")} />
              <span>{item.label}</span>
              {item.desc && (
                <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:block z-50 pointer-events-none">
                  <div className="w-56 rounded-xl border border-border/50 bg-background/95 backdrop-blur-xl saturate-[1.4] p-2.5 text-[11px] text-foreground shadow-xl whitespace-normal break-words">
                    {item.desc}
                  </div>
                </div>
              )}
              {isActive && <div className="ml-auto w-1 h-4 rounded-full bg-primary" />}
            </NavLink>
          )
        })}
      </nav>
      <div className="p-3 border-t border-border/30 space-y-0.5">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:text-foreground hover:bg-accent/50 hover:backdrop-blur-sm transition-all duration-200"
        >
          <Sun className="h-4 w-4 hidden dark:block" />
          <Moon className="h-4 w-4 block dark:hidden" />
          <span className="dark:hidden">Dark Mode</span>
          <span className="hidden dark:block">Light Mode</span>
        </button>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
            useAuthStore.getState().setAuthenticated(false)
            navigate("/login")
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive/80 hover:text-destructive hover:bg-destructive/10 hover:backdrop-blur-sm transition-all duration-200"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
