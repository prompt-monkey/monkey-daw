// The portable project file (.mdaw): a ZIP holding manifest.json and the project's audio.
// Audio is stored uncompressed (it rarely shrinks), the manifest is deflated.

import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate'
import { normalizeProject, usedAssetIds } from '../model/migrate'
import type { Id, Project } from '../model/types'
import { withUsedAssets, type AssetSource } from './repository'

export const PROJECT_FILE_EXTENSION = '.mdaw'
const FORMAT = 'monkey-daw-project'
const FORMAT_VERSION = 1

interface Manifest {
  format: typeof FORMAT
  formatVersion: number
  createdAt: string
  project: Project
  audio: { id: Id; name: string; file: string; type: string }[]
}

export class InvalidProjectFileError extends Error {}

const EXTENSIONS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
}

const zipAsync = (files: Zippable) =>
  new Promise<Uint8Array>((resolve, reject) => zip(files, (err, data) => (err ? reject(err) : resolve(data))))
const unzipAsync = (data: Uint8Array) =>
  new Promise<Unzipped>((resolve, reject) => unzip(data, (err, files) => (err ? reject(err) : resolve(files))))

export async function buildProjectFile(project: Project, source: AssetSource, now = new Date()): Promise<Blob> {
  const trimmed = withUsedAssets(project)
  const files: Zippable = {}
  const audio: Manifest['audio'] = []
  for (const id of usedAssetIds(trimmed)) {
    const blob = source(id)
    if (!blob) throw new Error(`The audio for "${trimmed.assets[id]?.name ?? id}" is not available.`)
    const type = blob.type || 'audio/wav'
    const file = `audio/${id}.${EXTENSIONS[type] ?? 'bin'}`
    files[file] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
    audio.push({ id, name: trimmed.assets[id]?.name ?? id, file, type })
  }
  const manifest: Manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: now.toISOString(),
    project: trimmed,
    audio,
  }
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }]
  const data = await zipAsync(files)
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

export interface ProjectFileContents {
  project: Project
  audio: Map<Id, Blob>
}

export async function readProjectFile(file: Blob): Promise<ProjectFileContents> {
  let entries: Unzipped
  try {
    entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new InvalidProjectFileError('This is not a monkey-daw project file.')
  }
  const manifestBytes = entries['manifest.json']
  if (!manifestBytes) throw new InvalidProjectFileError('The project file has no manifest.')
  let manifest: Partial<Manifest>
  try {
    manifest = JSON.parse(strFromU8(manifestBytes))
  } catch {
    throw new InvalidProjectFileError('The project manifest is damaged.')
  }
  if (manifest.format !== FORMAT) throw new InvalidProjectFileError('This is not a monkey-daw project file.')
  if ((manifest.formatVersion ?? 0) > FORMAT_VERSION) {
    throw new InvalidProjectFileError('This project was saved by a newer version of monkey-daw.')
  }
  const project = normalizeProject(manifest.project)
  const audio = new Map<Id, Blob>()
  for (const item of manifest.audio ?? []) {
    const bytes = entries[item.file]
    if (bytes) audio.set(item.id, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: item.type }))
  }
  const missing = usedAssetIds(project).filter((id) => !audio.has(id))
  if (missing.length) throw new InvalidProjectFileError(`The project file is missing ${missing.length} audio file(s).`)
  return { project, audio }
}
