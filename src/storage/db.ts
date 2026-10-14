import Dexie, { type EntityTable } from 'dexie'
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

export type DawDatabase = Dexie & {
  projects: EntityTable<ProjectRecord, 'id'>
  assets: EntityTable<AssetRecord, 'id'>
  recovery: EntityTable<RecoveryRecord, 'key'>
}

export function openDatabase(name = 'monkey-daw'): DawDatabase {
  const db = new Dexie(name) as DawDatabase
  db.version(1).stores({
    projects: 'id, updatedAt',
    assets: 'id',
    recovery: 'key',
  })
  return db
}
