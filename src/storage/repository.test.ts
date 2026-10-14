import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import type { Project } from '../model/types'
import { openDatabase, type DawDatabase } from './db'
import {
  MissingAudioError,
  clearRecovery,
  collectGarbage,
  deleteProject,
  listProjects,
  loadProject,
  readRecovery,
  renameSavedProject,
  saveProject,
  writeRecovery,
} from './repository'

let db: DawDatabase
let dbCount = 0
const freshDb = () => (db = openDatabase(`test-${++dbCount}`))
afterEach(() => db?.delete())

const audio = (text: string) => new Blob([text], { type: 'audio/wav' })
const sources: Record<string, Blob> = { a1: audio('one'), a2: audio('two'), a3: audio('three') }
const source = (id: string) => sources[id]

function projectUsing(...assetIds: string[]): Project {
  const p = createProject()
  for (const id of ['a1', 'a2', 'a3']) p.assets[id] = { id, name: id, duration: 1, sampleRate: 44100, channels: 2 }
  p.tracks[0].clips = assetIds.map((id, i) => createClip({ name: id, assetId: id, start: i, duration: 1 }))
  return p
}

describe('repository', () => {
  it('saves a project with only the audio it uses, and loads it back', async () => {
    freshDb()
    const p = projectUsing('a1', 'a2')
    await saveProject(db, p, source, 1000)
    expect(await db.assets.count()).toBe(2)
    const loaded = await loadProject(db, p.id)
    expect(loaded?.project.tracks[0].clips).toHaveLength(2)
    expect(Object.keys(loaded!.project.assets).sort()).toEqual(['a1', 'a2'])
    expect(await loaded!.audio.get('a2')!.text()).toBe('two')
    expect(await loadProject(db, 'prj_missing')).toBeNull()
  })

  it('lists projects newest first and keeps the creation time on resave', async () => {
    freshDb()
    const first = projectUsing('a1')
    const second = projectUsing('a2')
    await saveProject(db, first, source, 1000)
    await saveProject(db, second, source, 2000)
    await saveProject(db, first, source, 3000)
    const list = await listProjects(db)
    expect(list.map((p) => p.id)).toEqual([first.id, second.id])
    expect(list[0]).toMatchObject({ createdAt: 1000, updatedAt: 3000 })
  })

  it('fails clearly when audio is not available', async () => {
    freshDb()
    const p = projectUsing('a1')
    await expect(saveProject(db, p, () => undefined)).rejects.toBeInstanceOf(MissingAudioError)
    expect(await db.projects.count()).toBe(0)
  })

  it('renames a saved project', async () => {
    freshDb()
    const p = projectUsing('a1')
    await saveProject(db, p, source)
    await renameSavedProject(db, p.id, 'New name')
    expect((await loadProject(db, p.id))?.project.name).toBe('New name')
    expect((await listProjects(db))[0].name).toBe('New name')
  })

  it('deletes audio no project or session uses any more', async () => {
    freshDb()
    const keep = projectUsing('a1', 'a2')
    const remove = projectUsing('a2', 'a3')
    await saveProject(db, keep, source)
    await saveProject(db, remove, source)
    await writeRecovery(db, { project: projectUsing('a3'), savedId: null, dirty: true }, source)
    await deleteProject(db, remove.id)
    expect((await db.assets.toCollection().primaryKeys()).sort()).toEqual(['a1', 'a2', 'a3'])
    await clearRecovery(db)
    expect(await collectGarbage(db)).toBe(1)
    expect((await db.assets.toCollection().primaryKeys()).sort()).toEqual(['a1', 'a2'])
  })

  it('keeps the working session for recovery', async () => {
    freshDb()
    expect(await readRecovery(db)).toBeNull()
    const p = projectUsing('a3')
    await writeRecovery(db, { project: p, savedId: 'prj_saved', dirty: true }, source, 5000)
    const recovery = await readRecovery(db)
    expect(recovery?.record).toMatchObject({ savedId: 'prj_saved', dirty: true, savedAt: 5000 })
    expect(recovery?.project.id).toBe(p.id)
    expect(await recovery!.audio.get('a3')!.text()).toBe('three')
  })
})
