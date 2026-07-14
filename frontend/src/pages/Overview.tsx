import { Suspense, lazy } from "react"
import { Loader2 } from "lucide-react"
import { useAmbient } from "@/hooks/use-ambient"
import { useScrollSection } from "@/hooks/use-scroll-section"
import { OverviewHero } from "@/components/overview/OverviewHero"
import { SystemVitals } from "@/components/overview/SystemVitals"
import { QuickToggles } from "@/components/overview/QuickToggles"
import { AppDeck } from "@/components/overview/AppDeck"
import { AdminCockpit } from "@/components/overview/AdminCockpit"
import { AmbientOverlay } from "@/components/overview/AmbientOverlay"
import { ScrollIndicator } from "@/components/overview/ScrollIndicator"
import { SwipeHint } from "@/components/overview/SwipeHint"

const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })))

const SECTION_IDS = ["section-hero", "section-deck", "section-cockpit"]

export function OverviewPage() {
  const { stage, wake } = useAmbient()
  const { active, containerRef } = useScrollSection(SECTION_IDS)
  const isSimplified = stage === "simplified" || stage === "ambient"
  const fadeOut = isSimplified ? "opacity-0 pointer-events-none" : "opacity-100"

  return (
    <>
      {/* Mobile: full-screen scroll-snap overview */}
      <div
        ref={containerRef}
        id="overview-scroll-container"
        className={`fixed inset-0 z-50 overflow-y-auto snap-y snap-proximity overscroll-contain bg-background md:hidden transition-all duration-1000 ${
          isSimplified ? "overflow-y-hidden" : ""
        }`}
      >
        <section id="section-hero" className="h-[100dvh] snap-start relative">
          <div className={`flex flex-col justify-center gap-6 p-6 h-full transition-all duration-1000 ${fadeOut}`}>
            <OverviewHero />
            <SystemVitals />
            <QuickToggles />
          </div>
          <SwipeHint />
        </section>

        <section id="section-deck" className={`min-h-[100dvh] snap-start bg-zinc-950/50 p-6 pt-8 transition-all duration-1000 ${fadeOut}`}>
          <AppDeck />
        </section>

        <section id="section-cockpit" className={`min-h-[100dvh] snap-start bg-zinc-950/80 p-4 pt-8 transition-all duration-1000 ${fadeOut}`}>
          <AdminCockpit />
        </section>

        <ScrollIndicator active={active} count={SECTION_IDS.length} />
      </div>

      {/* Desktop: compact hero + full dashboard inside AppLayout */}
      <div className="hidden md:block max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-start">
          <OverviewHero />
          <div className="flex items-start gap-4">
            <SystemVitals />
          </div>
        </div>
        <QuickToggles />
        <AppDeck />
        <AdminCockpit />
        <Suspense fallback={<div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading...</div>}>
          <DashboardPage />
        </Suspense>
      </div>

      <AmbientOverlay stage={stage} onWake={wake} />
    </>
  )
}
