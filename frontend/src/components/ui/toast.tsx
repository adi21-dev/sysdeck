import { X, CheckCircle, AlertTriangle, Info } from "lucide-react"
import { useToastStore } from "@/lib/store"

const ICONS = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
}

const STYLES = {
  success:
    "border-green-500/20 bg-green-500/10 text-green-300",
  error:
    "border-red-500/20 bg-red-500/10 text-red-300",
  info:
    "border-blue-500/20 bg-blue-500/10 text-blue-300",
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const Icon = ICONS[t.type]
        return (
          <div
            key={t.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-xl animate-fade-in ${STYLES[t.type]}`}
          >
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button onClick={() => removeToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
