import { useState, useEffect, useRef, useCallback } from "react"
import { useLocation } from "react-router-dom"

export type AmbientStage = "normal" | "simplified" | "ambient"

interface UseAmbientOptions {
  timeoutSimplified?: number
  timeoutAmbient?: number
}

export function useAmbient({ timeoutSimplified = 10000, timeoutAmbient = 30000 }: UseAmbientOptions = {}) {
  const [stage, setStage] = useState<AmbientStage>("normal")
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const location = useLocation()
  const isOverview = location.pathname === "/overview"

  const wake = useCallback(() => {
    setStage("normal")
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setStage("simplified"), timeoutSimplified)
  }, [timeoutSimplified])

  useEffect(() => {
    if (!isOverview) {
      setStage("normal")
      clearTimeout(timerRef.current)
      return
    }
    wake()
    const events = ["pointerdown", "pointermove", "touchstart", "touchmove", "wheel", "keydown"]
    events.forEach((e) => document.addEventListener(e, wake, { passive: true }))
    return () => {
      clearTimeout(timerRef.current)
      events.forEach((e) => document.removeEventListener(e, wake))
    }
  }, [isOverview, wake])

  useEffect(() => {
    if (!isOverview || stage !== "simplified") return
    const t = setTimeout(() => setStage("ambient"), timeoutAmbient - timeoutSimplified)
    return () => clearTimeout(t)
  }, [stage, isOverview, timeoutAmbient, timeoutSimplified])

  return { stage, wake }
}
