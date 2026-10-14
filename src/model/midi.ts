// Pure note and pitch helpers for MIDI clips. Note times are in beats (quarter notes) from the
// clip's content origin; the clip itself sits on the timeline in seconds like any other clip.

import { createId } from './factory'
import type { MidiClip, Note } from './types'

export const MIN_PITCH = 0
export const MAX_PITCH = 127
/** Shortest note an edit can produce, in beats (a 1/64 note). */
export const MIN_NOTE_LENGTH = 1 / 16

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "C4" for 60 (middle C). */
export function noteName(pitch: number): string {
  return `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}

export function isBlackKey(pitch: number): boolean {
  return NAMES[((pitch % 12) + 12) % 12].includes('#')
}

export function pitchToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12)
}

/** Seconds per beat (quarter note). */
export const beatSeconds = (bpm: number) => 60 / bpm

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const clampPitch = (pitch: number) => clamp(Math.round(pitch), MIN_PITCH, MAX_PITCH)

export function createNote(fields: Omit<Note, 'id' | 'velocity'> & Partial<Pick<Note, 'velocity'>>): Note {
  return { id: createId('note'), velocity: 0.8, ...fields }
}

/** The clip's visible span in beats from its content origin: [offset, offset + duration]. */
export function clipBeatRange(clip: Pick<MidiClip, 'offset' | 'duration'>, bpm: number): { from: number; to: number } {
  const spb = beatSeconds(bpm)
  return { from: clip.offset / spb, to: (clip.offset + clip.duration) / spb }
}

/** Rounds to a grid of `step` beats (null: no snapping); never below 0. */
export function snapBeat(beat: number, step: number | null): number {
  const b = Math.max(0, beat)
  return step ? Math.round(b / step) * step : b
}

/** Moves notes by a beat and pitch offset, keeping them at or after beat 0 and on the keyboard. */
export function moveNotes(notes: Note[], dBeats: number, dPitch: number): Note[] {
  if (!notes.length) return notes
  const earliest = Math.min(...notes.map((n) => n.start))
  const lo = Math.min(...notes.map((n) => n.pitch))
  const hi = Math.max(...notes.map((n) => n.pitch))
  const db = Math.max(dBeats, -earliest)
  const dp = clamp(Math.round(dPitch), MIN_PITCH - lo, MAX_PITCH - hi)
  return notes.map((n) => ({ ...n, start: n.start + db, pitch: n.pitch + dp }))
}

/** Changes note lengths by `dBeats`, never below the minimum length. */
export function resizeNotes(notes: Note[], dBeats: number): Note[] {
  return notes.map((n) => ({ ...n, length: Math.max(MIN_NOTE_LENGTH, n.length + dBeats) }))
}

/** Shifts pitches by semitones; does nothing if any note would leave the keyboard. */
export function transposeNotes(notes: Note[], semitones: number): Note[] {
  if (notes.some((n) => n.pitch + semitones < MIN_PITCH || n.pitch + semitones > MAX_PITCH)) return notes
  return notes.map((n) => ({ ...n, pitch: n.pitch + semitones }))
}

/** Ids of notes touching a beat range on a pitch range (both ranges in any order). */
export function notesInRect(notes: Note[], b0: number, b1: number, p0: number, p1: number): string[] {
  const [from, to] = b0 <= b1 ? [b0, b1] : [b1, b0]
  const [lo, hi] = p0 <= p1 ? [p0, p1] : [p1, p0]
  return notes.filter((n) => n.pitch >= lo && n.pitch <= hi && n.start < to && n.start + n.length > from).map((n) => n.id)
}

/** Copies of notes placed so the earliest starts at `at`, with new ids. */
export function placeNotes(notes: Note[], at: number): Note[] {
  if (!notes.length) return []
  const earliest = Math.min(...notes.map((n) => n.start))
  return notes.map((n) => ({ ...n, id: createId('note'), start: Math.max(0, at + n.start - earliest) }))
}

/** Last beat any note reaches. */
export function notesEnd(notes: Note[]): number {
  return notes.reduce((end, n) => Math.max(end, n.start + n.length), 0)
}

/** Sorted by start, then pitch: the order notes are stored and played in. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}
