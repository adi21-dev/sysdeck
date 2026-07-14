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
  color = "hsl(173 75% 38%)",
  size = 96,
  strokeWidth = 6,
}: RadialGaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(value, max)
  const offset = circumference - (clamped / max) * circumference

  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-2xl glass-shine shadow-sm">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Inner Neumorphic shadow / Track circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(0 0% 100% / 0.08)"
            className="dark:stroke-white/5 stroke-black/5"
            strokeWidth={strokeWidth}
          />
          {/* Dynamic Fill Circle */}
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
            className="transition-all duration-700 ease-out"
          />
        </svg>
        {/* Value overlay inside gauge */}
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className={cn("text-base font-extrabold tracking-tight tabular-nums", value > max && "text-destructive")}>
            {value.toFixed(0)}<span className="text-[10px] text-muted-foreground font-normal ml-0.5">{unit}</span>
          </span>
        </div>
      </div>
      <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-widest leading-none mt-1">
        {label}
      </span>
    </div>
  )
}
