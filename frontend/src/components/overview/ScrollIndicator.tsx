import { cn } from "@/lib/utils"

const LABELS = ["Hero", "Deck", "Cockpit"]

export function ScrollIndicator({ active, count }: { active: number; count: number }) {
  return (
    <div className="fixed right-3 top-1/2 -translate-y-1/2 z-[90] flex flex-col gap-3 md:hidden">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Scroll to ${LABELS[i] ?? `section ${i + 1}`}`}
          className={cn(
            "w-2 h-2 rounded-full transition-all duration-500",
            i === active
              ? "bg-primary scale-125 shadow-[0_0_6px_hsl(173_80%_36%_/_0.5)]"
              : "bg-foreground/20 hover:bg-foreground/40",
          )}
        />
      ))}
    </div>
  )
}
