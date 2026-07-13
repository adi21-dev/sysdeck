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
  loading: boolean
  error: string | null
  setEntries: (entries: AuditEntry[], nextCursor: number | null, hasMore: boolean) => void
  appendEntries: (entries: AuditEntry[], nextCursor: number | null, hasMore: boolean) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
}

export const useAuditStore = create<AuditState>((set, get) => ({
  entries: [],
  nextCursor: null,
  hasMore: true,
  loading: false,
  error: null,
  setEntries: (entries, nextCursor, hasMore) => set({ entries, nextCursor, hasMore }),
  appendEntries: (entries, nextCursor, hasMore) =>
    set({ entries: [...get().entries, ...entries], nextCursor, hasMore }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}))
