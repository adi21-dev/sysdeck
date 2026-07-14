import { useEffect, useRef } from "react"

export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    let cancelled = false

    async function acquire() {
      if (!("wakeLock" in navigator)) return
      try {
        sentinelRef.current = await navigator.wakeLock.request("screen")
        sentinelRef.current.onrelease = () => {
          if (!cancelled && document.visibilityState === "visible") acquire()
        }
      } catch {
        // wake lock not granted (e.g. battery saver)
      }
    }

    acquire()

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) acquire()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      sentinelRef.current?.release()
    }
  }, [])
}
