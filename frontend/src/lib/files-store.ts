import { create } from "zustand"

export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: number
}

export interface UploadState {
  name: string
  progress: number
  status: "uploading" | "done" | "error"
}

interface FilesState {
  entries: FileEntry[]
  selected: Set<string>
  viewMode: "table" | "grid"
  uploads: UploadState[]
  loading: boolean
  error: string | null
  allowedPaths: string[]
  setEntries: (entries: FileEntry[]) => void
  setViewMode: (mode: "table" | "grid") => void
  toggleSelected: (path: string) => void
  clearSelection: () => void
  addUpload: (upload: UploadState) => void
  updateUpload: (name: string, progress: number) => void
  removeUpload: (name: string) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
  setAllowedPaths: (paths: string[]) => void
}

export const useFilesStore = create<FilesState>((set, get) => ({
  entries: [],
  selected: new Set(),
  viewMode: "table",
  uploads: [],
  loading: false,
  error: null,
  allowedPaths: [],
  setAllowedPaths: (paths) => set({ allowedPaths: paths }),
  setEntries: (entries) => set({ entries }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleSelected: (path) => {
    const sel = new Set(get().selected)
    if (sel.has(path)) sel.delete(path)
    else sel.add(path)
    set({ selected: sel })
  },
  clearSelection: () => set({ selected: new Set() }),
  addUpload: (upload) => set({ uploads: [...get().uploads, upload] }),
  updateUpload: (name, progress) =>
    set({
      uploads: get().uploads.map((u) =>
        u.name === name ? { ...u, progress } : u
      ),
    }),
  removeUpload: (name) =>
    set({ uploads: get().uploads.filter((u) => u.name !== name) }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}))
