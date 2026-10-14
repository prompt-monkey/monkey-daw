import Dexie, { type EntityTable } from 'dexie'
import type { SampleCategory, SignatureTag } from '../library/classify'
import type { Id, Project } from '../model/types'

export interface ProjectRecord {
  id: Id
  name: string
  createdAt: number
  updatedAt: number
  project: Project
  /** Assets the project uses; their audio lives in the assets table. */
  assetIds: Id[]
}

export interface AssetRecord {
  id: Id
  name: string
  blob: Blob
  size: number
}

/** The working session, autosaved continuously so a reload or crash loses nothing. */
export interface RecoveryRecord {
  key: 'current'
  project: Project
  /** Saved project this session belongs to, if any. */
  savedId: Id | null
  /** Whether the session had changes not yet saved to `savedId`. */
  dirty: boolean
  savedAt: number
  assetIds: Id[]
}

/** A sample library: a folder (or set of files) the user imported. */
export interface LibraryRecord {
  id: Id
  name: string
  createdAt: number
}

export interface SampleRecord {
  id: Id
  libraryId: Id
  /** Path inside the library, e.g. "Drums/Kicks/kick 01.wav". */
  path: string
  name: string
  type: string
  size: number
  category: SampleCategory
  bpm: number | null
  signature: SignatureTag | null
  /** Known once the sample has been decoded (e.g. on first preview). */
  duration: number | null
  blob: Blob
}

export type DawDatabase = Dexie & {
  projects: EntityTable<ProjectRecord, 'id'>
  assets: EntityTable<AssetRecord, 'id'>
  recovery: EntityTable<RecoveryRecord, 'key'>
  libraries: EntityTable<LibraryRecord, 'id'>
  samples: EntityTable<SampleRecord, 'id'>
}

export function openDatabase(name = 'monkey-daw'): DawDatabase {
  const db = new Dexie(name) as DawDatabase
  db.version(1).stores({
    projects: 'id, updatedAt',
    assets: 'id',
    recovery: 'key',
  })
  db.version(2).stores({
    libraries: 'id, createdAt',
    samples: 'id, libraryId',
  })
  return db
}

let shared: DawDatabase | null = null

/** The app's database, opened on first use. */
export function getDatabase(): DawDatabase {
  return (shared ??= openDatabase())
}
