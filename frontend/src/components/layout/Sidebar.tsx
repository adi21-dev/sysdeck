import { NavLink } from "react-router-dom"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { navItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore, useThemeStore } from "@/lib/store"

export function Sidebar() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const { isDark, toggle } = useThemeStore()
  const items = isLocal ? [...navItems, ...adminNavItems] : navItems

  return (
    <aside className="hidden md:flex h-screen w-60 flex-col border-r bg-sidebar-background">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <span className="font-semibold text-lg">NodeDesk</span>
        <button
          onClick={toggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
      <nav className="flex-1 space-y-1 p-3" role="navigation" aria-label="Main navigation">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
