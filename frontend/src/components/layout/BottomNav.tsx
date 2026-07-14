import { NavLink, useLocation } from "react-router-dom"
import { MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { primaryNavItems, secondaryNavItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore } from "@/lib/store"
import { useState, useEffect } from "react"
import { MoreSheet } from "./MoreSheet"

export function BottomNav() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const location = useLocation()
  const [mounted, setMounted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  // Overview page: hide bottom nav (ambient mode shows its own full-screen overlay)
  if (location.pathname === "/overview") return null

  // Check if the current route is a "secondary" (More) item to highlight the More button
  const secondaryPaths = isLocal
    ? [...secondaryNavItems, ...adminNavItems].map((i) => i.to)
    : secondaryNavItems.map((i) => i.to)
  const isMoreActive = secondaryPaths.includes(location.pathname)

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-border/40"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Main navigation"
      >
        <div className="flex items-stretch justify-around px-1 py-1 gap-0.5">
          {/* Primary nav items */}
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 flex-1 rounded-xl py-2 min-h-[52px] transition-all duration-200 press-effect relative",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )
              }
              aria-label={item.label}
            >
              {({ isActive }) => (
                <>
                  {/* Active indicator — top bar */}
                  {isActive && (
                    <span
                      className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  )}
                  {/* Icon container */}
                  <span
                    className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200",
                      isActive
                        ? "bg-primary/12"
                        : "bg-transparent"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-[18px] w-[18px] transition-all duration-200",
                        isActive ? "stroke-[2px]" : "stroke-[1.75px]"
                      )}
                    />
                  </span>
                  {/* Label */}
                  <span
                    className={cn(
                      "text-[10.5px] font-medium leading-none transition-all duration-200",
                      isActive ? "text-primary" : ""
                    )}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 flex-1 rounded-xl py-2 min-h-[52px] transition-all duration-200 press-effect relative",
              isMoreActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label="More options"
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
          >
            {isMoreActive && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] rounded-full bg-primary"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200",
                isMoreActive ? "bg-primary/12" : "bg-transparent"
              )}
            >
              <MoreHorizontal className="h-[18px] w-[18px] stroke-[1.75px]" />
            </span>
            <span className="text-[10.5px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      {/* More sheet — z-index higher than AmbientOverlay (z-[100]) */}
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}
