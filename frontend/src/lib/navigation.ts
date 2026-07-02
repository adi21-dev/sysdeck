import {
  LayoutDashboard,
  FolderOpen,
  Terminal,
  Smartphone,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
}

export const navItems: NavItem[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/files", icon: FolderOpen, label: "Files" },
  { to: "/scripts", icon: Terminal, label: "Scripts" },
  { to: "/control-center", icon: Smartphone, label: "Control Center" },
  { to: "/audit", icon: ScrollText, label: "Audit" },
]

export const adminNavItems: NavItem[] = [
  { to: "/settings", icon: Settings, label: "Settings" },
]
