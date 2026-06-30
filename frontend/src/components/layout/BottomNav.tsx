import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  FolderOpen,
  Terminal,
  Power,
  ScrollText,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/files", icon: FolderOpen, label: "Files" },
  { to: "/scripts", icon: Terminal, label: "Scripts" },
  { to: "/controls", icon: Power, label: "Controls" },
  { to: "/audit", icon: ScrollText, label: "Audit" },
  { to: "/settings", icon: Settings, label: "Settings" },
]

export function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-background px-2 pb-safe">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-0.5 py-2 px-2 text-[10px] font-medium transition-colors rounded-md min-w-0",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )
          }
        >
          <item.icon className="h-5 w-5" />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
