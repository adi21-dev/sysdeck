import { useRef, type KeyboardEvent } from "react"

export function TotpInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])

  function handleChange(i: number, digit: string) {
    if (digit.length > 1) return
    const next = value.split("")
    next[i] = digit
    onChange(next.join(""))
    if (digit && i < 5) refs.current[i + 1]?.focus()
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus()
  }

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          id={i === 0 ? id : undefined}
          ref={(el) => { refs.current[i] = el }}
          type="text"
          maxLength={1}
          value={value[i] || ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-11 h-12 text-center text-lg font-bold rounded-xl border border-input bg-background/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary/50 transition-all"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          required
        />
      ))}
    </div>
  )
}
