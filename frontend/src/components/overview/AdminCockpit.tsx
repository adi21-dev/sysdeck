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
    label: "Telemetry",
    description: "Real-time charts",
    path: "/dashboard",
    color: "text-emerald-500 bg-emerald-500/10",
  },
  {
    icon: FolderOpen,
    label: "Files",
    description: "Remote directory",
    path: "/files",
    color: "text-sky-500 bg-sky-500/10",
  },
  {
    icon: Terminal,
    label: "Terminal",
    description: "Command line",
    path: "/remote",
    color: "text-violet-500 bg-violet-500/10",
  },
  {
    icon: Play,
    label: "Scripts",
    description: "Custom scripts",
    path: "/scripts",
    color: "text-amber-500 bg-amber-500/10",
  },
  {
    icon: Wifi,
    label: "Network",
    description: "Connections",
    path: "/controls",
    color: "text-cyan-500 bg-cyan-500/10",
  },
  {
    icon: Monitor,
    label: "Controls",
    description: "Power & sound",
    path: "/controls",
    color: "text-rose-500 bg-rose-500/10",
  },
  {
    icon: Shield,
    label: "Audit Log",
    description: "Security log",
    path: "/audit",
    color: "text-orange-500 bg-orange-500/10",
  },
  {
    icon: Settings,
    label: "Settings",
    description: "Configuration",
    path: "/settings",
    color: "text-zinc-500 bg-zinc-500/10",
  },
]

export function AdminCockpit() {
  const navigate = useNavigate()

  return (
    <div className="px-4 pb-8 space-y-3">
      <h2 className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/80">
        Control Center
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-label={`Open ${item.label}`}
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(10)
              navigate(item.path)
            }}
            className="flex items-center gap-3.5 rounded-2xl border border-border/10 bg-card backdrop-blur-md p-4 text-left transition-all duration-200 hover:border-primary/20 hover:bg-accent/60 active:scale-[0.97] press-effect shadow-sm"
          >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.color}`}>
              <item.icon className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold tracking-tight text-foreground">{item.label}</div>
              <div className="text-[10px] text-muted-foreground/75 truncate mt-0.5">
                {item.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
