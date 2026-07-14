import { useEffect, useRef, useCallback } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { X, Moon, Sun, LogOut, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { secondaryNavItems, adminNavItems } from "@/lib/navigation"
import { useAuthStore, useThemeStore, useTunnelStore, useToastStore } from "@/lib/store"
import { useState } from "react"

interface MoreSheetProps {
  open: boolean
  onClose: () => void
}

export function MoreSheet({ open, onClose }: MoreSheetProps) {
  const isLocal = useAuthStore((s) => s.isLocal)
  const { isDark, toggle } = useThemeStore()
  const tunnelUrl = useTunnelStore((s) => s.url)
  const addToast = useToastStore((s) => s.addToast)
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const firstFocusable = useRef<HTMLButtonElement>(null)

  // Focus trap & Escape key
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    // Slight delay so animation plays before focus
    const t = setTimeout(() => firstFocusable.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "Tab" && sheetRef.current) {
        const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"]'
        )
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last?.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first?.focus() }
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener("keydown", onKey)
      prev?.focus()
    }
  }, [open, onClose])

  const handleCopy = useCallback(async () => {
    if (!tunnelUrl) return
    try {
      await navigator.clipboard.writeText(tunnelUrl)
      setCopied(true)
      addToast("Remote URL copied!", "success")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast("Failed to copy URL", "error")
    }
  }, [tunnelUrl, addToast])

  const handleLogout = useCallback(async () => {
    onClose()
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    useAuthStore.getState().setAuthenticated(false)
    navigate("/login")
  }, [navigate, onClose])

  // Swipe-to-close
  const touchStartY = useRef(0)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientY - touchStartY.current
    if (delta > 60) onClose()
  }

  if (!open) return null

  const secondaryItems = isLocal
    ? [...secondaryNavItems, ...adminNavItems]
    : secondaryNavItems

  return (
    <>
      {/* Backdrop */}
      <div
        className="bottom-sheet-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div
        ref={sheetRef}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="dialog"
        aria-modal="true"
        aria-label="More options"
        className="bottom-sheet-panel"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-border/60" aria-hidden="true" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3">
          <span className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">
            More
          </span>
          <button
            ref={firstFocusable}
            onClick={onClose}
            className="touch-target rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Secondary nav items */}
        <nav className="px-3 space-y-1">
          {secondaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-4 px-4 rounded-xl transition-all duration-200 press-effect",
                  "min-h-[52px]",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
                    isActive ? "bg-primary/15" : "bg-muted"
                  )}>
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.desc && (
                      <span className="text-xs text-muted-foreground truncate">{item.desc}</span>
                    )}
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-5 my-3 h-px bg-border/50" />

        {/* Settings actions */}
        <div className="px-3 space-y-1">
          {/* Theme toggle */}
          <button
            onClick={() => { toggle(); }}
            className="w-full flex items-center gap-4 px-4 rounded-xl min-h-[52px] text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 press-effect"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              {isDark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-400" />}
            </div>
            <span className="text-sm font-medium">
              {isDark ? "Light Mode" : "Dark Mode"}
            </span>
          </button>

          {/* Copy remote URL (local only) */}
          {isLocal && tunnelUrl && (
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-4 px-4 rounded-xl min-h-[52px] text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 press-effect"
              aria-label={copied ? "Remote URL copied" : "Copy remote URL"}
            >
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </div>
              <span className="text-sm font-medium">
                {copied ? "Copied!" : "Copy Remote URL"}
              </span>
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="mx-5 my-3 h-px bg-border/50" />

        {/* Sign out */}
        <div className="px-3 pb-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-4 px-4 rounded-xl min-h-[52px] text-destructive/80 hover:text-destructive hover:bg-destructive/8 transition-all duration-200 press-effect"
            aria-label="Sign out"
          >
            <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <LogOut className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </div>
    </>
  )
}
