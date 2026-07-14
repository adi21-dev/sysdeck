import { Suspense, lazy } from "react"
import { Loader2 } from "lucide-react"
import { useAmbient } from "@/hooks/use-ambient"
import { OverviewHero } from "@/components/overview/OverviewHero"
import { SystemVitals } from "@/components/overview/SystemVitals"
import { QuickToggles } from "@/components/overview/QuickToggles"
import { AppDeck } from "@/components/overview/AppDeck"
import { AdminCockpit } from "@/components/overview/AdminCockpit"
import { AmbientOverlay } from "@/components/overview/AmbientOverlay"

const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })))

export function OverviewPage() {
  const { stage, wake } = useAmbient()

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Unified Mobile + Desktop layout: header & bottom nav stay visible via AppLayout */}
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-center">
          <OverviewHero />
          <div className="w-full flex justify-center">
            <SystemVitals />
          </div>
        </div>
        
        <QuickToggles />
        <AppDeck />
        <AdminCockpit />
        
        {/* Lazy dashboard metrics */}
        <Suspense 
          fallback={
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading telemetry charts...</span>
            </div>
          }
        >
          <DashboardPage />
        </Suspense>
      </div>

      {/* Full screen ambient display overlay (Z-index 100 covers everything) */}
      <AmbientOverlay stage={stage} onWake={wake} />
    </div>
  )
}
