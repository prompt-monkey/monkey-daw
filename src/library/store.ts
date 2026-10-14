import { create } from 'zustand'
import type { Id } from '../model/types'
import { getDatabase, type LibraryRecord } from '../storage/db'
import { toast } from '../ui/toast'
import { EMPTY_FILTER, type SampleFilter } from './browse'
import { addLibrary, deleteLibrary, listLibraries, listSamples, renameLibrary, type IncomingFile, type SampleInfo } from './repo'

interface LibraryStore {
  libraries: LibraryRecord[]
  samples: SampleInfo[]
  loaded: boolean
  /** Name of the library being imported, while an import runs. */
  importing: string | null
  filter: SampleFilter
  /** Expanded tree nodes, as "libraryId" or "libraryId:folder/path". */
  expanded: string[]
  selectedId: Id | null
  previewingId: Id | null
  setFilter: (patch: Partial<SampleFilter>) => void
  toggleExpanded: (key: string) => void
  select: (id: Id | null) => void
}

export const useLibraryStore = create<LibraryStore>()((set) => ({
  libraries: [],
  samples: [],
  loaded: false,
  importing: null,
  filter: EMPTY_FILTER,
  expanded: [],
  selectedId: null,
  previewingId: null,
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  toggleExpanded: (key) =>
    set((s) => ({ expanded: s.expanded.includes(key) ? s.expanded.filter((k) => k !== key) : [...s.expanded, key] })),
  select: (selectedId) => set({ selectedId }),
}))

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export async function loadLibrary() {
  const db = getDatabase()
  const [libraries, samples] = await Promise.all([listLibraries(db), listSamples(db)])
  useLibraryStore.setState({ libraries, samples, loaded: true })
}

/** Imports files as a new library, expanded in the browser. */
export async function importLibrary(name: string, files: IncomingFile[]) {
  if (!files.length) return
  useLibraryStore.setState({ importing: name })
  try {
    const { library, added } = await addLibrary(getDatabase(), name, files)
    await loadLibrary()
    useLibraryStore.setState((s) => ({ expanded: [...s.expanded, library.id] }))
    const size = files.reduce((sum, f) => sum + f.file.size, 0)
    toast(added ? `Imported ${added} sample${added === 1 ? '' : 's'} into "${name}" (${formatMb(size)})` : `No WAV, MP3, OGG, FLAC or M4A files in "${name}"`)
    if (!added) await deleteLibrary(getDatabase(), library.id).then(loadLibrary)
    else void import('./audio').then((m) => m.measureUnknownDurations())
  } catch (err) {
    toast(`Could not import "${name}": ${err instanceof Error ? err.message : 'storage error'}`, 'error')
  } finally {
    useLibraryStore.setState({ importing: null })
  }
}

export async function removeLibrary(id: Id) {
  await deleteLibrary(getDatabase(), id)
  await loadLibrary()
}

export async function renameLibraryTo(id: Id, name: string) {
  if (!name.trim()) return
  await renameLibrary(getDatabase(), id, name.trim())
  await loadLibrary()
}

/** Records a duration learned by decoding, so filters and info can use it. */
export function rememberDuration(id: Id, duration: number) {
  useLibraryStore.setState((s) => ({ samples: s.samples.map((x) => (x.id === id && x.duration === null ? { ...x, duration } : x)) }))
}
