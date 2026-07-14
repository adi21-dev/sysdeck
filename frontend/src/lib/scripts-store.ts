import { create } from "zustand"

export interface ScriptOutput {
  stream: "stdout" | "stderr" | "system"
  data: string
}

interface ScriptsState {
  mode: "live" | "wait"
  scriptType: "powershell" | "cmd"
  content: string
  predefined: string
  running: boolean
  runId: string | null
  output: ScriptOutput[]
  status: "idle" | "running" | "completed" | "failed" | "timed_out"
  consoleOpen: boolean
  setMode: (m: "live" | "wait") => void
  setScriptType: (t: "powershell" | "cmd") => void
  setContent: (c: string) => void
  setPredefined: (p: string) => void
  setRunning: (r: boolean) => void
  setRunId: (id: string | null) => void
  addOutput: (o: ScriptOutput) => void
  clearOutput: () => void
  setStatus: (s: "idle" | "running" | "completed" | "failed" | "timed_out") => void
  setConsoleOpen: (o: boolean) => void
}

export const useScriptsStore = create<ScriptsState>((set, get) => ({
  mode: "live",
  scriptType: "powershell",
  content: "",
  predefined: "Custom",
  running: false,
  runId: null,
  output: [],
  status: "idle",
  consoleOpen: false,
  setMode: (m) => set({ mode: m }),
  setScriptType: (t) => set({ scriptType: t }),
  setContent: (c) => set({ content: c }),
  setPredefined: (p) => set({ predefined: p }),
  setRunning: (r) => set({ running: r }),
  setRunId: (id) => set({ runId: id }),
  addOutput: (o) =>
    set({ output: [...get().output, o] }),
  clearOutput: () => set({ output: [] }),
  setStatus: (s) => set({ status: s }),
  setConsoleOpen: (o) => set({ consoleOpen: o }),
}))
