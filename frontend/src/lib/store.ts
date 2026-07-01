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
  isLocal: boolean
  setAuthenticated: (val: boolean) => void
  setSetupComplete: (val: boolean) => void
  setLocal: (val: boolean) => void
}

export interface Toast {
  id: string
  message: string
  type: "success" | "error" | "info"
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, type: Toast["type"]) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message, type) => {
    const id = crypto.randomUUID()
    set({ toasts: [...get().toasts, { id, message, type }] })
    setTimeout(() => get().removeToast(id), 4000)
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

interface TelemetryState {
  current: Telemetry | null
  history: Telemetry[]
  setCurrent: (t: Telemetry) => void
  addToHistory: (t: Telemetry) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setupComplete: false,
  isLocal: true,
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setSetupComplete: (val) => set({ setupComplete: val }),
  setLocal: (val) => set({ isLocal: val }),
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

interface ThemeState {
  isDark: boolean
  toggle: () => void
  setDark: (v: boolean) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  toggle: () => {
    const next = !get().isDark
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
    set({ isDark: next })
  },
  setDark: (v) => {
    document.documentElement.classList.toggle("dark", v)
    localStorage.setItem("theme", v ? "dark" : "light")
    set({ isDark: v })
  },
}))

// Init theme from localStorage or system preference
const saved = localStorage.getItem("theme")
if (saved) {
  const isDark = saved === "dark"
  document.documentElement.classList.toggle("dark", isDark)
  useThemeStore.getState().setDark(isDark)
} else {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true
  document.documentElement.classList.toggle("dark", prefersDark)
}

interface ConnectionState {
  status: "connected" | "disconnected" | "offline"
  setStatus: (s: "connected" | "disconnected" | "offline") => void
  retryConnection: (() => void) | null
  setRetryConnection: (fn: (() => void) | null) => void
  shuttingDown: boolean
  setShuttingDown: (v: boolean) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "disconnected",
  setStatus: (status) => set({ status }),
  retryConnection: null,
  setRetryConnection: (fn) => set({ retryConnection: fn }),
  shuttingDown: false,
  setShuttingDown: (v) => set({ shuttingDown: v }),
}))

interface TunnelState {
  status: string
  url: string | null
  error: string | null
  setTunnel: (t: { status: string; url: string | null; error: string | null }) => void
}

export const useTunnelStore = create<TunnelState>((set) => ({
  status: "idle",
  url: null,
  error: null,
  setTunnel: (t) => set(t),
}))
