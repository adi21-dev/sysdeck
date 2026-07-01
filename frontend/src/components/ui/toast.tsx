import { X } from "lucide-react"
import { useToastStore } from "@/lib/store"

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg animate-in slide-in-from-right ${
            t.type === "success"
              ? "border-green-500/30 bg-green-950 text-green-200"
              : t.type === "error"
                ? "border-red-500/30 bg-red-950 text-red-200"
                : "border-blue-500/30 bg-blue-950 text-blue-200"
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
