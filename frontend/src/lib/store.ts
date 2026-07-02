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

// Hardware Control State
export interface AudioData {
  volume: number
  muted: boolean
  devices: string[]
  default_device: string
}

export interface DisplayData {
  brightness: number
  night_light: boolean
}

export interface TogglesData {
  wifi: boolean
  bluetooth: boolean
  dark_mode: boolean
  dnd: boolean
}

interface HardwareState {
  audio: AudioData | null
  display: DisplayData | null
  toggles: TogglesData | null
  loading: boolean
  error: string | null

  fetchAudio: () => Promise<void>
  fetchDisplay: () => Promise<void>
  fetchToggles: () => Promise<void>
  fetchAll: () => Promise<void>

  setVolume: (volume: number) => Promise<void>
  setMuted: (muted: boolean) => Promise<void>
  setDevice: (device: string) => Promise<void>
  triggerMedia: (action: string) => Promise<void>
  setBrightness: (brightness: number) => Promise<void>
  setNightLight: (enabled: boolean) => Promise<void>
  setWifi: (enabled: boolean) => Promise<void>
  setBluetooth: (enabled: boolean) => Promise<void>
  setDarkMode: (enabled: boolean) => Promise<void>
  setDnd: (enabled: boolean) => Promise<void>
}

export const useHardwareStore = create<HardwareState>((set, get) => {
  const handleApiCall = async <T>(url: string, method: string, body?: any): Promise<T> => {
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }
    const res = await fetch(url, options)
    const json = await res.json()
    if (!json.success) {
      throw new Error(json.message || "Operation failed")
    }
    return json.data
  }

  return {
    audio: null,
    display: null,
    toggles: null,
    loading: false,
    error: null,

    fetchAudio: async () => {
      try {
        const data = await handleApiCall<AudioData>("/api/audio/status", "GET")
        set({ audio: data })
      } catch (err: any) {
        set({ error: err.message })
      }
    },

    fetchDisplay: async () => {
      try {
        const data = await handleApiCall<DisplayData>("/api/display/status", "GET")
        set({ display: data })
      } catch (err: any) {
        set({ error: err.message })
      }
    },

    fetchToggles: async () => {
      try {
        const data = await handleApiCall<TogglesData>("/api/toggles/status", "GET")
        set({ toggles: data })
      } catch (err: any) {
        set({ error: err.message })
      }
    },

    fetchAll: async () => {
      set({ loading: true, error: null })
      try {
        const [audio, display, toggles] = await Promise.all([
          handleApiCall<AudioData>("/api/audio/status", "GET"),
          handleApiCall<DisplayData>("/api/display/status", "GET"),
          handleApiCall<TogglesData>("/api/toggles/status", "GET"),
        ])
        set({ audio, display, toggles, loading: false })
      } catch (err: any) {
        set({ error: err.message, loading: false })
      }
    },

    setVolume: async (volume) => {
      await handleApiCall("/api/audio/volume", "POST", { volume })
      set({ audio: get().audio ? { ...get().audio!, volume } : null })
    },

    setMuted: async (muted) => {
      await handleApiCall("/api/audio/mute", "POST", { muted })
      set({ audio: get().audio ? { ...get().audio!, muted } : null })
    },

    setDevice: async (device) => {
      await handleApiCall("/api/audio/device", "POST", { device })
      set({ audio: get().audio ? { ...get().audio!, default_device: device } : null })
    },

    triggerMedia: async (action) => {
      await handleApiCall("/api/audio/media", "POST", { action })
    },

    setBrightness: async (brightness) => {
      await handleApiCall("/api/display/brightness", "POST", { brightness })
      set({ display: get().display ? { ...get().display!, brightness } : null })
    },

    setNightLight: async (night_light) => {
      await handleApiCall("/api/display/night-light", "POST", { night_light })
      set({ display: get().display ? { ...get().display!, night_light } : null })
    },

    setWifi: async (enabled) => {
      await handleApiCall("/api/toggles/wifi", "POST", { enabled })
      set({ toggles: get().toggles ? { ...get().toggles!, wifi: enabled } : null })
    },

    setBluetooth: async (enabled) => {
      await handleApiCall("/api/toggles/bluetooth", "POST", { enabled })
      set({ toggles: get().toggles ? { ...get().toggles!, bluetooth: enabled } : null })
    },

    setDarkMode: async (enabled) => {
      await handleApiCall("/api/toggles/dark-mode", "POST", { enabled })
      set({ toggles: get().toggles ? { ...get().toggles!, dark_mode: enabled } : null })
      useThemeStore.getState().setDark(enabled)
    },

    setDnd: async (enabled) => {
      await handleApiCall("/api/toggles/dnd", "POST", { enabled })
      set({ toggles: get().toggles ? { ...get().toggles!, dnd: enabled } : null })
    },
  }
})
