import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { navItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore } from "@/lib/store"
import { useState, useEffect } from "react"

export function BottomNav() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const items = isLocal ? [...navItems, ...adminNavItems] : navItems
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="flex items-center justify-around py-1">
        {items.map((item) => {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive: navActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 p-2 rounded-lg transition-all duration-200 min-w-0",
                  navActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
