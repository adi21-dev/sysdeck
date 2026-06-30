import { create } from "zustand"

export interface AuditEntry {
  id: number
  event: string
  details: string | null
  ip_address: string | null
  created_at: number
}

interface AuditState {
  entries: AuditEntry[]
  nextCursor: number | null
  hasMore: boolean
  filters: { event: string; from: string; to: string }
  loading: boolean
  error: string | null
  setEntries: (entries: AuditEntry[], nextCursor: number | null, hasMore: boolean) => void
  appendEntries: (entries: AuditEntry[], nextCursor: number | null, hasMore: boolean) => void
  setFilters: (filters: { event: string; from: string; to: string }) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
  reset: () => void
}

export const useAuditStore = create<AuditState>((set, get) => ({
  entries: [],
  nextCursor: null,
  hasMore: true,
  filters: { event: "", from: "", to: "" },
  loading: false,
  error: null,
  setEntries: (entries, nextCursor, hasMore) => set({ entries, nextCursor, hasMore }),
  appendEntries: (entries, nextCursor, hasMore) =>
    set({ entries: [...get().entries, ...entries], nextCursor, hasMore }),
  setFilters: (filters) => set({ filters }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
  reset: () =>
    set({
      entries: [],
      nextCursor: null,
      hasMore: true,
      error: null,
    }),
}))
