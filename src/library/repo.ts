// Sample libraries in IndexedDB. Sample audio is stored as the original file bytes.

import { createId } from '../model/factory'
import type { Id } from '../model/types'
import type { DawDatabase, LibraryRecord, SampleRecord } from '../storage/db'
import { AUDIO_EXTENSIONS, detectBpm, detectCategory, detectSignature } from './classify'
import { wavDuration } from './duration'

export interface IncomingFile {
  /** Path inside the imported folder, e.g. "Drums/kick.wav". */
  path: string
  file: Blob
}

/** Sample metadata without the audio, for listing. */
export type SampleInfo = Omit<SampleRecord, 'blob'>

const nameOf = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')

/** Stores audio files as a library. Non-audio files are skipped. Returns the library and sample count. */
export async function addLibrary(
  db: DawDatabase,
  name: string,
  files: IncomingFile[],
  now = Date.now(),
): Promise<{ library: LibraryRecord; added: number }> {
  const library: LibraryRecord = { id: createId('lib'), name, createdAt: now }
  const audio = files.filter((f) => AUDIO_EXTENSIONS.test(f.path))
  // WAV durations come from the header; other formats are measured later by decoding.
  const durations = await Promise.all(audio.map((f) => wavDuration(f.file)))
  const samples: SampleRecord[] = audio.map(({ path, file }, i) => ({
    id: createId('smp'),
    libraryId: library.id,
    path,
    name: nameOf(path),
    type: file.type,
    size: file.size,
    category: detectCategory(path),
    bpm: detectBpm(path),
    signature: detectSignature(path),
    duration: durations[i],
    blob: file,
  }))
  await db.transaction('rw', db.libraries, db.samples, async () => {
    await db.libraries.add(library)
    await db.samples.bulkAdd(samples)
  })
  return { library, added: samples.length }
}

export async function listLibraries(db: DawDatabase): Promise<LibraryRecord[]> {
  return db.libraries.orderBy('createdAt').toArray()
}

/** All samples' metadata, without loading their audio into memory. */
export async function listSamples(db: DawDatabase): Promise<SampleInfo[]> {
  const out: SampleInfo[] = []
  await db.samples.each((record) => {
    const { blob: _blob, ...info } = record
    out.push(info)
  })
  return out
}

export async function getSampleAudio(db: DawDatabase, id: Id): Promise<Blob | null> {
  return (await db.samples.get(id))?.blob ?? null
}

export async function setSampleDuration(db: DawDatabase, id: Id, duration: number): Promise<void> {
  await db.samples.update(id, { duration })
}

export async function renameLibrary(db: DawDatabase, id: Id, name: string): Promise<void> {
  await db.libraries.update(id, { name })
}

export async function deleteLibrary(db: DawDatabase, id: Id): Promise<void> {
  await db.transaction('rw', db.libraries, db.samples, async () => {
    await db.samples.where('libraryId').equals(id).delete()
    await db.libraries.delete(id)
  })
}
