import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { Monitor, Moon, Sun, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { navItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore, useThemeStore } from "@/lib/store"
import { useState, useEffect, useId } from "react"

export function Sidebar() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const { isDark, toggle } = useThemeStore()
  const items = isLocal ? [...navItems, ...adminNavItems] : navItems
  const location = useLocation()
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  const tooltipId = useId()

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    useAuthStore.getState().setAuthenticated(false)
    navigate("/login")
  }

  return (
    <aside
      className="hidden md:flex fixed left-0 top-0 h-full w-60 flex-col z-50 border-r border-sidebar-border/60"
      style={{ background: "var(--sidebar-background)", backdropFilter: "blur(20px) saturate(1.6)", WebkitBackdropFilter: "blur(20px) saturate(1.6)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border/50">
        <div className="w-9 h-9 rounded-xl bg-primary/12 flex items-center justify-center ring-1 ring-primary/20 flex-shrink-0">
          <Monitor className="w-[18px] h-[18px] text-primary" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-[15px] tracking-tight leading-none">SysDeck</span>
          <span className="text-[10px] text-muted-foreground/70 tracking-widest uppercase mt-0.5">System Dashboard</span>
        </div>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto"
        aria-label="Main navigation"
      >
        {items.map((item) => {
          const isActive = location.pathname === item.to
          const descId = item.desc ? `${tooltipId}-${item.to}` : undefined

          return (
            <div key={item.to} className="group relative">
              <NavLink
                to={item.to}
                aria-current={isActive ? "page" : undefined}
                aria-describedby={descId}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 w-full",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/60"
                )}
              >
                {/* Icon */}
                <span
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200",
                    isActive ? "bg-primary/15" : "bg-transparent group-hover:bg-sidebar-accent"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-[15px] w-[15px] transition-colors",
                      isActive ? "text-primary" : "text-sidebar-foreground group-hover:text-foreground"
                    )}
                    aria-hidden="true"
                  />
                </span>

                <span className="flex-1 truncate">{item.label}</span>

                {/* Active pill indicator */}
                {isActive && (
                  <span className="ml-auto w-1 h-5 rounded-full bg-primary" aria-hidden="true" />
                )}
              </NavLink>

              {/* Tooltip — accessible via aria-describedby + focus */}
              {item.desc && (
                <div
                  id={descId}
                  role="tooltip"
                  className={cn(
                    "absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 pointer-events-none",
                    "hidden group-hover:block group-focus-within:block"
                  )}
                >
                  <div className="w-56 rounded-xl border border-border/60 glass-strong p-2.5 text-[11px] text-foreground shadow-xl whitespace-normal break-words animate-fade-in">
                    {item.desc}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer actions */}
      <div className="px-3 py-3 border-t border-sidebar-border/50 space-y-0.5">
        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-all duration-200"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span className="w-7 h-7 rounded-lg bg-transparent group-hover:bg-sidebar-accent flex items-center justify-center flex-shrink-0">
            {isDark
              ? <Sun className="h-[15px] w-[15px] text-amber-400" aria-hidden="true" />
              : <Moon className="h-[15px] w-[15px] text-indigo-400" aria-hidden="true" />
            }
          </span>
          <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
        </button>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive/75 hover:text-destructive hover:bg-destructive/8 transition-all duration-200"
          aria-label="Sign out of SysDeck"
        >
          <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0">
            <LogOut className="h-[15px] w-[15px]" aria-hidden="true" />
          </span>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}
