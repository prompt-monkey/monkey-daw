// Reading and writing projects, audio and the recovery session in IndexedDB.

import { normalizeProject, usedAssetIds } from '../model/migrate'
import type { Id, Project } from '../model/types'
import type { DawDatabase, ProjectRecord, RecoveryRecord } from './db'

/** Supplies encoded audio for an asset that isn't stored yet. */
export type AssetSource = (id: Id) => Blob | undefined

export class MissingAudioError extends Error {}

export interface ProjectSummary {
  id: Id
  name: string
  updatedAt: number
  createdAt: number
}

/** The project with its asset list trimmed to the assets its clips use. */
export function withUsedAssets(project: Project): Project {
  const used = new Set(usedAssetIds(project))
  return { ...project, assets: Object.fromEntries(Object.entries(project.assets).filter(([id]) => used.has(id))) }
}

/** Stores the audio of any used asset that isn't in the database yet. */
async function storeAssets(db: DawDatabase, project: Project, source: AssetSource): Promise<Id[]> {
  const ids = usedAssetIds(project)
  const existing = new Set((await db.assets.bulkGet(ids)).filter((a) => a).map((a) => a!.id))
  for (const id of ids) {
    if (existing.has(id)) continue
    const blob = source(id)
    if (!blob) throw new MissingAudioError(`The audio for "${project.assets[id]?.name ?? id}" is not available.`)
    await db.assets.put({ id, name: project.assets[id]?.name ?? id, blob, size: blob.size })
  }
  return ids
}

export async function saveProject(db: DawDatabase, project: Project, source: AssetSource, now = Date.now()): Promise<void> {
  const trimmed = withUsedAssets(project)
  await db.transaction('rw', db.projects, db.assets, async () => {
    const assetIds = await storeAssets(db, trimmed, source)
    const previous = await db.projects.get(project.id)
    const record: ProjectRecord = {
      id: project.id,
      name: project.name,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      project: trimmed,
      assetIds,
    }
    await db.projects.put(record)
  })
}

export async function listProjects(db: DawDatabase): Promise<ProjectSummary[]> {
  const records = await db.projects.orderBy('updatedAt').reverse().toArray()
  return records.map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt, createdAt }))
}

export interface LoadedProject {
  project: Project
  /** Encoded audio for each asset the project uses. */
  audio: Map<Id, Blob>
}

async function loadAudio(db: DawDatabase, ids: Id[]): Promise<Map<Id, Blob>> {
  const audio = new Map<Id, Blob>()
  const records = await db.assets.bulkGet(ids)
  records.forEach((r, i) => {
    if (!r) throw new MissingAudioError(`Audio ${ids[i]} is missing from storage.`)
    audio.set(r.id, r.blob)
  })
  return audio
}

export async function loadProject(db: DawDatabase, id: Id): Promise<LoadedProject | null> {
  const record = await db.projects.get(id)
  if (!record) return null
  const project = normalizeProject(record.project)
  return { project, audio: await loadAudio(db, usedAssetIds(project)) }
}

export async function renameSavedProject(db: DawDatabase, id: Id, name: string): Promise<void> {
  const record = await db.projects.get(id)
  if (!record) return
  await db.projects.put({ ...record, name, project: { ...record.project, name } })
}

export async function deleteProject(db: DawDatabase, id: Id): Promise<void> {
  await db.projects.delete(id)
  await collectGarbage(db)
}

/** Deletes stored audio that no saved project and no recovery session uses. */
export async function collectGarbage(db: DawDatabase): Promise<number> {
  return db.transaction('rw', db.projects, db.assets, db.recovery, async () => {
    const used = new Set<Id>()
    await db.projects.each((p) => p.assetIds.forEach((id) => used.add(id)))
    const recovery = await db.recovery.get('current')
    recovery?.assetIds.forEach((id) => used.add(id))
    const unused = (await db.assets.toCollection().primaryKeys()).filter((id) => !used.has(id))
    await db.assets.bulkDelete(unused)
    return unused.length
  })
}

export async function writeRecovery(
  db: DawDatabase,
  session: Omit<RecoveryRecord, 'key' | 'savedAt' | 'assetIds'>,
  source: AssetSource,
  now = Date.now(),
): Promise<void> {
  const project = withUsedAssets(session.project)
  await db.transaction('rw', db.assets, db.recovery, async () => {
    const assetIds = await storeAssets(db, project, source)
    await db.recovery.put({ ...session, project, key: 'current', savedAt: now, assetIds })
  })
}

export interface Recovery {
  record: RecoveryRecord
  project: Project
  audio: Map<Id, Blob>
}

export async function readRecovery(db: DawDatabase): Promise<Recovery | null> {
  const record = await db.recovery.get('current')
  if (!record) return null
  const project = normalizeProject(record.project)
  return { record, project, audio: await loadAudio(db, usedAssetIds(project)) }
}

export async function clearRecovery(db: DawDatabase): Promise<void> {
  await db.recovery.delete('current')
}
