import { useState, useEffect } from "react"
import { ChevronUp } from "lucide-react"

export function SwipeHint() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const onScroll = () => setVisible(false)
    window.addEventListener("scroll", onScroll, { once: true })
    const t = setTimeout(() => setVisible(false), 6000)
    return () => {
      window.removeEventListener("scroll", onScroll)
      clearTimeout(t)
    }
  }, [])

  if (!visible) return null

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 animate-bounce z-10">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Swipe up</span>
      <ChevronUp className="h-4 w-4 text-muted-foreground/40" />
    </div>
  )
}
