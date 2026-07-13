import { useState, useRef } from "react"
import { CircleHelp } from "lucide-react"
import { cn } from "@/lib/utils"

interface InfoButtonProps {
  content: string
  className?: string
}

export function InfoButton({ content, className }: InfoButtonProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: -9999, left: -9999 })
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center cursor-help relative", className)}
      onMouseEnter={() => {
        if (ref.current) {
          const rect = ref.current.getBoundingClientRect()
          setPos({ top: rect.top - 8, left: rect.left + rect.width / 2 })
          setShow(true)
        }
      }}
      onMouseLeave={() => setShow(false)}
    >
      <CircleHelp className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
      <div
        className="fixed z-[9999] pointer-events-none"
        style={{
          top: pos.top,
          left: pos.left,
          transform: "translate(-50%, -100%)",
          opacity: show ? 1 : 0,
          transition: "opacity 0.12s ease",
        }}
      >
        <div className="w-72 max-h-40 overflow-y-auto rounded-xl border border-border/50 bg-background/95 backdrop-blur-xl saturate-[1.4] p-3 text-xs text-foreground shadow-xl whitespace-normal break-words">
          {content}
        </div>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-background/95 border-r border-b border-border/50 rotate-45" />
      </div>
    </span>
  )
}
