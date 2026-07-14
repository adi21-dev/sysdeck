import { cn } from "@/lib/utils"

interface RadialGaugeProps {
  value: number
  max?: number
  label: string
  unit?: string
  color?: string
  size?: number
  strokeWidth?: number
}

export function RadialGauge({
  value,
  max = 100,
  label,
  unit = "%",
  color = "hsl(173 80% 40%)",
  size = 88,
  strokeWidth = 6,
}: RadialGaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(value, max)
  const offset = circumference - (clamped / max) * circumference

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(0 0% 100% / 0.06)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <span className={cn("text-lg font-bold tabular-nums", value > max && "text-destructive")}>
        {value.toFixed(0)}<span className="text-xs text-muted-foreground">{unit}</span>
      </span>
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  )
}
