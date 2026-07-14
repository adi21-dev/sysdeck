import * as React from "react"
import { cn } from "@/lib/utils"

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onChange, label, disabled, ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        if (!disabled) onChange(!checked)
      }
    }

    return (
      <label
        className={cn(
          "inline-flex items-center gap-3 cursor-pointer select-none touch-target touch-action-manipulation",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
          ref={ref}
          {...props}
        />
        <div
          role="switch"
          aria-checked={checked}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-11 h-6 rounded-full transition-all duration-200 relative flex items-center px-0.5",
            checked
              ? "bg-primary/20 shadow-inner"
              : "bg-muted shadow-inner border border-border/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          )}
        >
          {/* Thumb */}
          <div
            className={cn(
              "w-5 h-5 rounded-full transition-transform duration-200 shadow-md",
              checked
                ? "translate-x-5 bg-primary"
                : "translate-x-0 bg-foreground/60 dark:bg-foreground/40",
              "neu-control"
            )}
          />
        </div>
        {label && <span className="text-sm font-medium leading-none">{label}</span>}
      </label>
    )
  }
)

Switch.displayName = "Switch"
