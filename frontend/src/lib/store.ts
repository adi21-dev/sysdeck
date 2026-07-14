import { create } from "zustand"

interface Telemetry {
  timestamp: number
  cpu_usage: number
  ram_used: number
  ram_total: number
  net_rx_bps: number
  net_tx_bps: number
  temperature_cpu: number | null
  temperature_gpu: number | null
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
  setTunnel: (t: { status: string; url: string | null }) => void
}

export const useTunnelStore = create<TunnelState>((set) => ({
  status: "idle",
  url: null,
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

export interface NetworkData {
  ipv4: string
  interfaces: InterfaceInfo[]
  default_gateway: string
  dns_servers: string[]
  connection_type: string
  internet_connection: boolean | null
}

export interface InterfaceInfo {
  name: string
  status: string
  interface_type: string
  mac: string
  ipv4: string | null
}

export interface WifiNetwork {
  ssid: string
  signal_strength: number
  security_type: string
  connected: boolean
}

export interface ControlCenterToggle {
  dark_mode: boolean
  wifi_on: boolean | null
  bluetooth_on: boolean | null
  dnd_on: boolean | null
}

interface HardwareState {
  audio: AudioData | null
  display: DisplayData | null
  toggles: TogglesData | null
  network: NetworkData | null
  wifiNetworks: WifiNetwork[]
  controlCenter: ControlCenterToggle | null
  loading: boolean
  error: string | null

  fetchAudio: () => Promise<void>
  fetchDisplay: () => Promise<void>
  fetchToggles: () => Promise<void>
  fetchAll: () => Promise<void>
  fetchNetwork: () => Promise<void>
  fetchWifiNetworks: () => Promise<void>
  fetchControlCenter: () => Promise<void>
  toggleControlCenter: (toggle: string, enabled: boolean) => Promise<void>
  flushDns: () => Promise<void>
  toggleAdapter: (name: string, enabled: boolean) => Promise<void>
  wifiConnect: (ssid: string, password?: string) => Promise<void>
  wifiDisconnect: () => Promise<void>
  monitorOff: () => Promise<void>

  setVolume: (volume: number) => Promise<void>
  setMuted: (muted: boolean) => Promise<void>
  setDevice: (device: string) => Promise<void>
  triggerMedia: (action: string) => Promise<void>
  setBrightness: (brightness: number) => Promise<void>
  setNightLight: (enabled: boolean) => Promise<void>
  setDarkMode: (enabled: boolean) => Promise<void>
  lockWorkstation: () => Promise<void>
}

interface AppDeckState {
  windows: WindowInfo[]
  setWindows: (w: WindowInfo[]) => void
}

interface WindowInfo {
  hwnd: number
  title: string
  exe_path: string
}

export const useAppDeckStore = create<AppDeckState>((set) => ({
  windows: [],
  setWindows: (windows) => set({ windows }),
}))

export function applyHardwareUpdate(update: { type: string; [key: string]: any }) {
  const state = useHardwareStore.getState()
  switch (update.type) {
    case "volume":
      if (state.audio) useHardwareStore.setState({ audio: { ...state.audio, volume: update.volume } })
      break
    case "mute":
      if (state.audio) useHardwareStore.setState({ audio: { ...state.audio, muted: update.muted } })
      break
    case "brightness":
      if (state.display) useHardwareStore.setState({ display: { ...state.display, brightness: update.brightness } })
      break
    case "dark_mode":
      if (state.toggles) useHardwareStore.setState({ toggles: { ...state.toggles, dark_mode: update.enabled } })
      if (state.controlCenter) useHardwareStore.setState({ controlCenter: { ...state.controlCenter, dark_mode: update.enabled } })
      break
    case "wifi":
      if (state.toggles) useHardwareStore.setState({ toggles: { ...state.toggles, wifi: update.enabled } })
      if (state.controlCenter) useHardwareStore.setState({ controlCenter: { ...state.controlCenter, wifi_on: update.enabled } })
      break
    case "dnd":
      if (state.toggles) useHardwareStore.setState({ toggles: { ...state.toggles, dnd: update.enabled } })
      if (state.controlCenter) useHardwareStore.setState({ controlCenter: { ...state.controlCenter, dnd_on: update.enabled } })
      break
    case "device":
      state.fetchAudio()
      break
  }
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
    network: null,
    wifiNetworks: [],
    controlCenter: null,
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

    fetchNetwork: async () => {
      try {
        const data = await handleApiCall<NetworkData>("/api/network/status", "GET")
        set({ network: data })
      } catch (err: any) {
        set({ error: err.message })
      }
    },

    fetchWifiNetworks: async () => {
      try {
        const data = await handleApiCall<WifiNetwork[]>("/api/network/wifi", "GET")
        set({ wifiNetworks: data })
      } catch {
        // silently fail — Wi-Fi may not be available
      }
    },

    fetchControlCenter: async () => {
      try {
        const data = await handleApiCall<ControlCenterToggle>("/api/control-center/status", "GET")
        set({ controlCenter: data })
      } catch (err: any) {
        set({ error: err.message })
      }
    },

    toggleControlCenter: async (toggle, enabled) => {
      const prev = get().controlCenter
      const prevToggles = get().toggles
      if (prev) {
        const updated = { ...prev }
        if (toggle === "dark_mode") updated.dark_mode = enabled
        else if (toggle === "wifi") updated.wifi_on = enabled
        else if (toggle === "dnd") updated.dnd_on = enabled
        set({ controlCenter: updated })
      }
      if (prevToggles) {
        const updated = { ...prevToggles }
        if (toggle === "wifi") updated.wifi = enabled
        else if (toggle === "dnd") updated.dnd = enabled
        set({ toggles: updated })
      }
      try {
        await handleApiCall("/api/control-center/toggle", "POST", { toggle, enabled })
        get().fetchControlCenter()
      } catch (err: any) {
        set({ controlCenter: prev, toggles: prevToggles })
        throw err
      }
    },

    flushDns: async () => {
      await handleApiCall("/api/network/flush-dns", "POST")
    },

    toggleAdapter: async (name, enabled) => {
      await handleApiCall("/api/network/adapter", "POST", { name, enabled })
      setTimeout(() => get().fetchNetwork(), 3000)
    },

    wifiConnect: async (ssid, password) => {
      await handleApiCall("/api/network/wifi/connect", "POST", { ssid, password })
      setTimeout(() => { get().fetchNetwork(); get().fetchWifiNetworks() }, 4000)
    },

    wifiDisconnect: async () => {
      await handleApiCall("/api/network/wifi/disconnect", "POST")
      setTimeout(() => get().fetchWifiNetworks(), 2000)
    },

    monitorOff: async () => {
      await handleApiCall("/api/control-center/monitor", "POST", { action: "off" })
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
      get().fetchAudio()
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

    setDarkMode: async (enabled) => {
      await handleApiCall("/api/toggles/dark-mode", "POST", { enabled })
      set({ toggles: get().toggles ? { ...get().toggles!, dark_mode: enabled } : null })
      useThemeStore.getState().setDark(enabled)
    },

    lockWorkstation: async () => {
      await handleApiCall("/api/power/lock", "POST")
    },
  }
})
