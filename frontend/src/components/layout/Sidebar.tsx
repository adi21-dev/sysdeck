import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { navItems } from "@/lib/navigation"

export function Sidebar() {
  return (
    <aside className="hidden md:flex h-screen w-60 flex-col border-r bg-sidebar-background">
      <div className="flex h-14 items-center border-b px-6 font-semibold text-lg">
        NodeDesk
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
