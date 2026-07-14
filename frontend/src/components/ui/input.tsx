import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "flex w-full rounded-xl px-3 py-1.5 text-sm shadow-sm transition-all duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 touch-action-manipulation",
  {
    variants: {
      variant: {
        default: "border border-input bg-background/50 backdrop-blur-sm saturate-[1.4] hover:border-muted-foreground/30",
        "neu-inset": "neu-inset border-none text-foreground focus-visible:ring-offset-0",
      },
      size: {
        default: "h-10",
        touch: "h-12 text-base",
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    }
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
