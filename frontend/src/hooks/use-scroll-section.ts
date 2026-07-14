import { useState, useEffect, useRef } from "react"

export function useScrollSection(sectionIds: string[]) {
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = active
        let bestRatio = 0
        for (const entry of entries) {
          const idx = sectionIds.indexOf(entry.target.id)
          if (idx >= 0 && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio
            bestIdx = idx
          }
        }
        setActive(bestIdx)
      },
      { root: el, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    const targets = sectionIds.map((id) => el.querySelector(`#${id}`)).filter(Boolean)
    targets.forEach((t) => t && observer.observe(t))
    return () => observer.disconnect()
  }, [sectionIds.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  return { active, containerRef }
}
