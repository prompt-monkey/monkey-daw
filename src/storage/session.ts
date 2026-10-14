// The open project's link to storage: which saved project it is, whether it has unsaved
// changes, and the continuous recovery autosave. UI code calls these functions; they keep the
// project store, the audio engine and IndexedDB in step.

import { create } from 'zustand'
import { downloadBlob, exportFilename } from '../audio/export'
import { engine } from '../audio/engine'
import { createId, createProject } from '../model/factory'
import type { Id, Project } from '../model/types'
import { useProjectStore } from '../state/projectStore'
import { stop } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { toast } from '../ui/toast'
import { openDatabase, type DawDatabase } from './db'
import { PROJECT_FILE_EXTENSION, buildProjectFile, readProjectFile } from './projectFile'
import {
  collectGarbage,
  deleteProject,
  listProjects,
  loadProject,
  readRecovery,
  renameSavedProject,
  saveProject,
  writeRecovery,
  type ProjectSummary,
} from './repository'

interface SessionStore {
  /** Saved project the open project belongs to; null if it was never saved. */
  savedId: Id | null
  /** The project as last saved or opened. Any other state means unsaved changes. */
  baseline: Project | null
  saving: boolean
  /** Saved projects, most recent first. */
  projects: ProjectSummary[]
}

export const useSessionStore = create<SessionStore>()(() => ({
  savedId: null,
  baseline: null,
  saving: false,
  projects: [],
}))

/** True when the open project differs from its saved (or freshly opened) state. */
export function useIsDirty(): boolean {
  const project = useProjectStore((s) => s.project)
  const baseline = useSessionStore((s) => s.baseline)
  return project !== baseline
}

const isDirty = () => useProjectStore.getState().project !== useSessionStore.getState().baseline

let database: DawDatabase | null = null
const db = () => (database ??= openDatabase())
const audioSource = (id: Id) => engine.assets.source(id)

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback)

export async function refreshProjectList() {
  useSessionStore.setState({ projects: await listProjects(db()) })
}

async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // Not supported; the browser decides.
  }
}

async function restoreAudio(audio: Map<Id, Blob>) {
  await Promise.all([...audio].map(([id, blob]) => engine.assets.restore(id, blob, engine.context)))
}

/** Replaces the open project (undo history starts over). */
function openInEditor(project: Project, savedId: Id | null, clean: boolean) {
  stop()
  useViewStore.getState().setSelection([])
  useProjectStore.getState().load(project)
  useSessionStore.setState({ savedId, baseline: clean ? project : null })
}

export async function saveCurrent(): Promise<boolean> {
  const project = useProjectStore.getState().project
  useSessionStore.setState({ saving: true })
  try {
    await saveProject(db(), project, audioSource)
    useSessionStore.setState({ savedId: project.id, baseline: project })
    await Promise.all([refreshProjectList(), requestPersistence(), flushRecovery()])
    toast(`Saved "${project.name}"`)
    return true
  } catch (err) {
    toast(`Could not save: ${errorText(err, 'storage error')}`, 'error')
    return false
  } finally {
    useSessionStore.setState({ saving: false })
  }
}

/** Saves the open project as a new project and switches to it. */
export async function saveCopy(): Promise<void> {
  const current = useProjectStore.getState().project
  const copy: Project = { ...current, id: createId('prj'), name: `${current.name} copy` }
  openInEditor(copy, null, false)
  await saveCurrent()
}

export async function openProject(id: Id): Promise<void> {
  try {
    const loaded = await loadProject(db(), id)
    if (!loaded) throw new Error('That project no longer exists.')
    await restoreAudio(loaded.audio)
    openInEditor(loaded.project, id, true)
    await flushRecovery()
    toast(`Opened "${loaded.project.name}"`)
  } catch (err) {
    toast(`Could not open the project: ${errorText(err, 'storage error')}`, 'error')
  }
}

export async function newProject(): Promise<void> {
  openInEditor(createProject(), null, true)
  await flushRecovery()
}

export async function deleteSavedProject(id: Id): Promise<void> {
  try {
    await deleteProject(db(), id)
    // The open project stays open, but is no longer saved anywhere.
    if (useSessionStore.getState().savedId === id) useSessionStore.setState({ savedId: null, baseline: null })
    await refreshProjectList()
  } catch (err) {
    toast(`Could not delete the project: ${errorText(err, 'storage error')}`, 'error')
  }
}

export async function renameSaved(id: Id, name: string, renameOpenProject: (name: string) => void): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  if (id === useSessionStore.getState().savedId) {
    renameOpenProject(trimmed)
    await saveCurrent()
  } else {
    await renameSavedProject(db(), id, trimmed)
    await refreshProjectList()
  }
}

export async function downloadProjectFile(): Promise<void> {
  const project = useProjectStore.getState().project
  try {
    const blob = await buildProjectFile(project, audioSource)
    downloadBlob(blob, exportFilename(project.name, 'project').replace(/\.wav$/, PROJECT_FILE_EXTENSION))
  } catch (err) {
    toast(`Could not create the project file: ${errorText(err, 'unknown error')}`, 'error')
  }
}

/** Opens a .mdaw file and saves it as a project in this browser. */
export async function importProjectFile(file: File): Promise<void> {
  try {
    const { project, audio } = await readProjectFile(file)
    // Never overwrite a different saved project that happens to share the id.
    const clash = useSessionStore.getState().projects.some((p) => p.id === project.id)
    const imported = clash ? { ...project, id: createId('prj') } : project
    await restoreAudio(audio)
    openInEditor(imported, null, false)
    await saveCurrent()
  } catch (err) {
    toast(`Could not open "${file.name}": ${errorText(err, 'unknown error')}`, 'error')
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota, persisted: await navigator.storage.persisted() }
  } catch {
    return null
  }
}

export async function makeStoragePersistent(): Promise<boolean> {
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

// --- Recovery autosave ---------------------------------------------------------------------

const AUTOSAVE_DELAY_MS = 800
let timer: ReturnType<typeof setTimeout> | null = null
let writing: Promise<void> = Promise.resolve()
/** True while a change hasn't reached IndexedDB yet. */
let pending = false

async function flushRecovery(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const project = useProjectStore.getState().project
  const { savedId } = useSessionStore.getState()
  const dirty = isDirty()
  writing = writing
    .then(() => writeRecovery(db(), { project, savedId, dirty }, audioSource))
    .then(() => {
      pending = false
    })
    .catch((err) => console.warn('Autosave failed', err))
  return writing
}

function scheduleRecovery() {
  pending = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushRecovery(), AUTOSAVE_DELAY_MS)
}

/** Reopens the session that was open when the page last closed. Returns whether it did. */
export async function restoreLastSession(): Promise<boolean> {
  try {
    const recovery = await readRecovery(db())
    if (!recovery) return false
    await restoreAudio(recovery.audio)
    openInEditor(recovery.project, recovery.record.savedId, !recovery.record.dirty)
    if (recovery.record.dirty) toast('Restored your last session, including unsaved changes')
    return true
  } catch (err) {
    toast(`Could not restore the last session: ${errorText(err, 'storage error')}`, 'error')
    return false
  }
}

/** Restores the last session, then keeps it autosaved. Call once at startup. */
export async function startSession(): Promise<void> {
  const restored = await restoreLastSession()
  if (!restored) useSessionStore.setState({ baseline: useProjectStore.getState().project })
  await refreshProjectList().catch(() => {})
  useProjectStore.subscribe((s, prev) => s.project !== prev.project && scheduleRecovery())
  useSessionStore.subscribe((s, prev) => s.savedId !== prev.savedId && scheduleRecovery())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushRecovery())
  window.addEventListener('pagehide', () => void flushRecovery())
  // Only warn on leaving if the latest change might not have reached storage yet.
  window.addEventListener('beforeunload', (e) => {
    if (!pending) return
    void flushRecovery()
    e.preventDefault()
  })
  void collectGarbage(db()).catch(() => {})
}
