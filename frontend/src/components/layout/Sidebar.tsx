import { NavLink, useNavigate } from "react-router-dom"
import { Monitor, Moon, Sun, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { navItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore, useThemeStore } from "@/lib/store"

export function Sidebar() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const { isDark, toggle } = useThemeStore()
  const items = isLocal ? [...navItems, ...adminNavItems] : navItems
  const navigate = useNavigate()

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-full w-60 flex-col border-r bg-card z-50">
      <div className="flex items-center gap-3 p-6 border-b">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Monitor className="w-4 h-4 text-primary" />
        </div>
        <span className="font-semibold text-lg">NodeDesk</span>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-accent",
                isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t space-y-2">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Sun className="h-4 w-4 hidden dark:block" />
          <Moon className="h-4 w-4 block dark:hidden" />
          <span className="dark:hidden">Dark Mode</span>
          <span className="hidden dark:block">Light Mode</span>
        </button>
        <button
          onClick={() => { useAuthStore.getState().setAuthenticated(false); navigate("/login") }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
