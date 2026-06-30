import {
  LayoutDashboard,
  FolderOpen,
  Terminal,
  Power,
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
  { to: "/controls", icon: Power, label: "Controls" },
  { to: "/audit", icon: ScrollText, label: "Audit" },
  { to: "/settings", icon: Settings, label: "Settings" },
]
