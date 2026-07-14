import { useNavigate } from "react-router-dom"
import {
  BarChart3,
  FolderOpen,
  Terminal,
  Play,
  Wifi,
  Settings,
  Shield,
  Monitor,
} from "lucide-react"

interface CockpitItem {
  icon: React.ElementType
  label: string
  description: string
  path: string
  color: string
}

const ITEMS: CockpitItem[] = [
  {
    icon: BarChart3,
    label: "System Health",
    description: "Historical charts & metrics",
    path: "/dashboard",
    color: "text-emerald-400",
  },
  {
    icon: FolderOpen,
    label: "Files",
    description: "Browse & manage files",
    path: "/files",
    color: "text-sky-400",
  },
  {
    icon: Terminal,
    label: "Terminal",
    description: "Command line access",
    path: "/remote",
    color: "text-violet-400",
  },
  {
    icon: Play,
    label: "Scripts",
    description: "Run & manage scripts",
    path: "/scripts",
    color: "text-amber-400",
  },
  {
    icon: Wifi,
    label: "Network",
    description: "Wi-Fi & connections",
    path: "/controls",
    color: "text-cyan-400",
  },
  {
    icon: Monitor,
    label: "Controls",
    description: "Power & hardware",
    path: "/controls",
    color: "text-rose-400",
  },
  {
    icon: Shield,
    label: "Audit",
    description: "Security events",
    path: "/audit",
    color: "text-orange-400",
  },
  {
    icon: Settings,
    label: "Settings",
    description: "Configuration",
    path: "/settings",
    color: "text-zinc-400",
  },
]

export function AdminCockpit() {
  const navigate = useNavigate()

  return (
    <div className="px-4 pb-8">
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
        Admin Library
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-label={`Open ${item.label}`}
              onClick={() => navigate(item.path)}
            className="flex items-start gap-3 rounded-2xl border border-border/50 bg-zinc-950/50 p-4 text-left transition-all duration-200 hover:border-primary/20 hover:bg-zinc-900/50 active:scale-[0.98]"
          >
            <div className={`mt-0.5 ${item.color}`}>
              <item.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                {item.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
