import { create } from "zustand"

interface Telemetry {
  timestamp: number
  cpu_usage: number
  ram_used: number
  ram_total: number
  net_rx_bps: number
  net_tx_bps: number
  temperature: number | null
  disk_used: number
  disk_total: number
  battery_percent: number | null
  battery_charging: boolean | null
}

interface AuthState {
  isAuthenticated: boolean
  setupComplete: boolean
  setAuthenticated: (val: boolean) => void
  setSetupComplete: (val: boolean) => void
  logout: () => void
}

interface TelemetryState {
  current: Telemetry | null
  history: Telemetry[]
  setCurrent: (t: Telemetry) => void
  addToHistory: (t: Telemetry) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setupComplete: false,
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setSetupComplete: (val) => set({ setupComplete: val }),
  logout: () => set({ isAuthenticated: false }),
}))

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  current: null,
  history: [],
  setCurrent: (t) => set({ current: t }),
  addToHistory: (t) => {
    const h = get().history
    const next = [...h, t].slice(-300)
    set({ history: next })
  },
}))

interface ConnectionState {
  status: "connected" | "disconnected" | "offline"
  setStatus: (s: "connected" | "disconnected" | "offline") => void
  retryConnection: (() => void) | null
  setRetryConnection: (fn: (() => void) | null) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "disconnected",
  setStatus: (status) => set({ status }),
  retryConnection: null,
  setRetryConnection: (fn) => set({ retryConnection: fn }),
}))
