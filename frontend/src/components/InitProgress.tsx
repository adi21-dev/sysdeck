import { useEffect, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "@/lib/store"

interface InitHistory {
  steps: string[]
}

type Mode = "checking" | "fresh" | "returning"
type Phase = "loading" | "done"

export function InitProgress() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>("checking")
  const [phase, setPhase] = useState<Phase>("loading")
  const [steps, setSteps] = useState<string[]>([])
  const checkedRef = useRef(0)
  const [, forceRender] = useState(0)

  // Step 1: check setup status to determine fresh vs returning
  useEffect(() => {
    let done = false
    ;(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000))
        try {
          const res = await fetch("/api/setup/status")
          const data = await res.json()
          if (done) return
          useAuthStore.getState().setSetupComplete(data.is_setup_complete)
          setMode(data.is_setup_complete ? "returning" : "fresh")
          return
        } catch { /* retry */ }
      }
      if (!done) setMode("fresh")
    })()
    return () => { done = true }
  }, [])

  // Step 2: poll init-history until "Ready"
  useEffect(() => {
    if (mode === "checking") return
    let done = false
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/setup/init-history")
        if (done) return
        const data: InitHistory = await res.json()
        setSteps(data.steps)
        if (data.steps.includes("Ready")) {
          setPhase("done")
          clearInterval(id)
        }
      } catch { /* server not ready yet */ }
    }, 300)
    return () => { done = true; clearInterval(id) }
  }, [mode])

  // Animate checkmarks for fresh mode
  useEffect(() => {
    if (mode !== "fresh" || phase !== "loading" || steps.length === 0) return
    if (checkedRef.current >= steps.length) return
    const t = setTimeout(() => {
      checkedRef.current = Math.min(checkedRef.current + 1, steps.length)
      forceRender((c) => c + 1)
    }, 200)
    return () => clearTimeout(t)
  }, [mode, phase, steps.length])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8"
      style={{ background: "linear-gradient(135deg, hsl(180 30% 20%), hsl(180 40% 12%))" }}>
      <div className="flex flex-col items-center gap-3 mb-10">
        <div className="size-12 rounded-xl bg-primary/20 flex items-center justify-center">
          <svg className="size-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-white/90">SysDeck Agent</h1>
      </div>

      {mode === "checking" && (
        <div className="flex items-center justify-center gap-2 py-4">
          <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      )}

      {mode === "fresh" && (
        <div className="flex flex-col gap-3 w-72 min-h-[200px] justify-center">
          {steps.map((step, i) => (
            <div key={i}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/10 text-white/90 opacity-100 transition-all duration-300">
              <span className={`size-5 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                i < checkedRef.current ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/50"
              }`}>
                {i < checkedRef.current ? "\u2713" : ""}
              </span>
              <span className="text-sm">{step}</span>
            </div>
          ))}
          {steps.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-4">
              <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          )}
          {phase === "done" && (
            <button
              onClick={() => navigate("/setup")}
              className="mt-6 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:brightness-110 transition-all"
            >
              Continue to Setup
            </button>
          )}
        </div>
      )}

      {mode === "returning" && (
        <div className="flex flex-col items-center gap-6 w-72">
          {phase === "loading" && (
            <>
              <p className="text-sm text-white/60">Starting up...</p>
              <div className="flex items-center justify-center gap-2">
                <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="size-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </>
          )}
          {phase === "done" && (
            <button
              onClick={() => navigate("/dashboard")}
              className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:brightness-110 transition-all"
            >
              Continue to Dashboard
            </button>
          )}
        </div>
      )}
    </div>
  )
}
