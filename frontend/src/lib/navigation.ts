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

/** All nav items (used by sidebar — shows everything) */
export const navItems: NavItem[] = [
  { to: "/overview",  icon: LayoutDashboard, label: "Overview",  desc: "Always-on system overview — clock, vitals, and controls" },
  { to: "/files",     icon: FolderOpen,      label: "Files",     desc: "Browse, upload, and download files remotely" },
  { to: "/scripts",   icon: Terminal,        label: "Scripts",   desc: "Run PowerShell/CMD scripts with configurable timeout" },
  { to: "/remote",    icon: MousePointer2,   label: "Remote",    desc: "Full remote desktop access" },
  { to: "/controls",  icon: Smartphone,      label: "Controls",  desc: "Power actions, audio, display, toggles, network" },
  { to: "/audit",     icon: ScrollText,      label: "Audit",     desc: "Security and activity event log" },
]

export const adminNavItems: NavItem[] = [
  { to: "/settings", icon: Settings, label: "Settings", desc: "Password, TOTP, sessions, tunnel, paths, WoL" },
]

/**
 * PRIMARY nav items — shown in the bottom nav bar (max 4 + "More").
 * Chosen for highest daily-use frequency.
 */
export const primaryNavItems: NavItem[] = [
  { to: "/overview",  icon: LayoutDashboard, label: "Overview" },
  { to: "/files",     icon: FolderOpen,      label: "Files" },
  { to: "/controls",  icon: Smartphone,      label: "Controls" },
  { to: "/remote",    icon: MousePointer2,   label: "Remote" },
]

/**
 * SECONDARY nav items — shown in the "More" bottom sheet.
 * Less frequently accessed.
 */
export const secondaryNavItems: NavItem[] = [
  { to: "/scripts", icon: Terminal,   label: "Scripts",   desc: "Run PowerShell/CMD scripts" },
  { to: "/audit",   icon: ScrollText, label: "Audit Log", desc: "Security and activity event log" },
]
