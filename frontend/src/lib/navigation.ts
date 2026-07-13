import {
  LayoutDashboard,
  FolderOpen,
  Terminal,
  Smartphone,
  ScrollText,
  Settings,
  MousePointer2,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  desc?: string
}

export const navItems: NavItem[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", desc: "System telemetry overview — CPU, RAM, disk, network" },
  { to: "/files", icon: FolderOpen, label: "Files", desc: "Browse, upload, and download files remotely" },
  { to: "/scripts", icon: Terminal, label: "Scripts", desc: "Run PowerShell/CMD scripts with configurable timeout" },
  { to: "/remote", icon: MousePointer2, label: "Remote Desktop", desc: "Full remote desktop access" },
  { to: "/controls", icon: Smartphone, label: "Controls", desc: "Power actions, audio, display, toggles, network" },
  { to: "/audit", icon: ScrollText, label: "Audit", desc: "Security and activity event log" },
]

export const adminNavItems: NavItem[] = [
  { to: "/settings", icon: Settings, label: "Settings", desc: "Password, TOTP, sessions, tunnel, paths, WoL" },
]
