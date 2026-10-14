// Importing .mid files: as new MIDI tracks on the timeline, or into an open clip.

import { createNote } from '../model/midi'
import type { Id, Note } from '../model/types'
import { addMidiTracks } from '../state/actions'
import { toast } from '../ui/toast'
import { parseMidiFile, type MidiPart } from './smf'

export const MIDI_FILE = /\.midi?$/i

async function readParts(file: File): Promise<MidiPart[] | null> {
  try {
    const { parts } = parseMidiFile(new Uint8Array(await file.arrayBuffer()))
    if (!parts.length) toast(`"${file.name}" has no notes.`, 'error')
    return parts.length ? parts : null
  } catch (err) {
    toast(`Could not read "${file.name}": ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    return null
  }
}

const withIds = (notes: MidiPart['notes']): Note[] => notes.map((n) => createNote(n))

/** Adds one MIDI track per part of the file, with its clip starting at `start`. */
export async function importMidiAsTracks(file: File, start: number): Promise<Id[]> {
  const parts = await readParts(file)
  if (!parts) return []
  const base = file.name.replace(MIDI_FILE, '')
  return addMidiTracks(
    parts.map((p) => ({ name: parts.length === 1 ? base : p.name, notes: withIds(p.notes) })),
    start,
  )
}

/** All notes of a file merged into one list (for importing into an open clip). */
export async function readMidiNotes(file: File): Promise<Note[] | null> {
  const parts = await readParts(file)
  return parts && withIds(parts.flatMap((p) => p.notes))
}
