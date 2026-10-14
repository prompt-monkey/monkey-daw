// Turns stored or imported project data into a valid current Project, filling in fields that
// older data may lack. Anything that can't be repaired is rejected.

import { normalizeEffect } from '../effects/definitions'
import { createProject } from './factory'
import { resolveTarget } from '../automation/targets'
import { MAX_PITCH, MIN_NOTE_LENGTH, sortNotes } from './midi'
import { isMidiClip, type AudioClip, type AutomationLane, type Bus, type Clip, type Effect, type Instrument, type MidiClip, type Note, type Project, type Track } from './types'

export class InvalidProjectError extends Error {}

type Loose<T> = Partial<T> & Record<string, unknown>

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)
const bool = (v: unknown) => v === true

/** Valid effects only; unknown types (e.g. from a newer version) are dropped. */
const effects = (v: unknown): Effect[] => (Array.isArray(v) ? v.map(normalizeEffect).filter((e) => e !== null) : [])

const SYNTHS = ['keys', 'pluck', 'bass', 'pad', 'lead', 'sampler'] as const

function normalizeNote(raw: Loose<Note>): Note | null {
  if (typeof raw?.id !== 'string' || typeof raw.pitch !== 'number' || !Number.isFinite(raw.pitch)) return null
  return {
    id: raw.id,
    pitch: Math.min(MAX_PITCH, Math.max(0, Math.round(raw.pitch))),
    start: Math.max(0, num(raw.start, 0)),
    length: Math.max(MIN_NOTE_LENGTH, num(raw.length, 1)),
    velocity: Math.min(1, Math.max(0, num(raw.velocity, 0.8))),
  }
}

function normalizeInstrument(raw: unknown): Instrument {
  const r = (raw ?? {}) as Loose<Instrument>
  const type = SYNTHS.find((t) => t === r.type) ?? 'keys'
  const sample = r.sample as Loose<NonNullable<Instrument['sample']>> | undefined
  const instrument: Instrument = { type, glide: Math.min(1, Math.max(0, num(r.glide, 0))) }
  if (typeof sample?.assetId === 'string') {
    instrument.sample = { assetId: sample.assetId, root: Math.min(MAX_PITCH, Math.max(0, Math.round(num(sample.root, 60)))) }
  }
  // A sampler without a sample has nothing to play.
  if (type === 'sampler' && !instrument.sample) instrument.type = 'keys'
  return instrument
}

function normalizeClip(raw: Loose<Clip>): Clip | null {
  const notes = (raw as Loose<MidiClip>).notes
  const assetId = (raw as Loose<AudioClip>).assetId
  if (typeof raw.id !== 'string' || (typeof assetId !== 'string' && !Array.isArray(notes))) return null
  const duration = num(raw.duration, 0)
  if (duration <= 0) return null
  const content = Array.isArray(notes)
    ? { notes: sortNotes(notes.map((n) => normalizeNote(n as Loose<Note>)).filter((n) => n !== null)) }
    : { assetId: assetId as string }
  return {
    id: raw.id,
    name: str(raw.name, 'Clip'),
    ...content,
    start: Math.max(0, num(raw.start, 0)),
    offset: Math.max(0, num(raw.offset, 0)),
    duration,
    gain: num(raw.gain, 1),
    fadeIn: Math.max(0, num(raw.fadeIn, 0)),
    fadeOut: Math.max(0, num(raw.fadeOut, 0)),
  }
}

function normalizeBus(raw: Loose<Bus>): Bus | null {
  if (typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    name: str(raw.name, 'Bus'),
    volume: num(raw.volume, 1),
    pan: num(raw.pan, 0),
    muted: bool(raw.muted),
    effects: effects(raw.effects),
    fxBypass: bool(raw.fxBypass),
  }
}

function normalizeTrack(raw: Loose<Track>, busIds: Set<string>): Track | null {
  if (typeof raw.id !== 'string') return null
  const kind = raw.kind === 'midi' || raw.kind === 'drums' ? raw.kind : 'audio'
  const output = typeof raw.output === 'string' && busIds.has(raw.output) ? raw.output : 'master'
  const sends = Array.isArray(raw.sends)
    ? raw.sends
        .filter((s): s is { busId: string; level: number } => typeof s?.busId === 'string' && busIds.has(s.busId))
        .map((s) => ({ busId: s.busId, level: num(s.level, 0) }))
    : []
  // Audio clips only go on audio tracks, MIDI clips only on MIDI tracks.
  const clips = (Array.isArray(raw.clips) ? raw.clips.map((c) => normalizeClip(c as Loose<Clip>)).filter((c) => c !== null) : []).filter(
    (c) => isMidiClip(c) === (kind === 'midi'),
  )
  const track: Track = {
    id: raw.id,
    name: str(raw.name, 'Track'),
    kind,
    volume: num(raw.volume, 1),
    pan: num(raw.pan, 0),
    muted: bool(raw.muted),
    solo: bool(raw.solo),
    output,
    sends,
    effects: effects(raw.effects),
    fxBypass: bool(raw.fxBypass),
    automation: [],
    ...(kind === 'midi' ? { instrument: normalizeInstrument(raw.instrument) } : {}),
    clips,
  }
  track.automation = lanes(raw.automation, track)
  return track
}

/** Valid lanes only: targets that still exist on the track, one lane per target, clean points. */
function lanes(v: unknown, track: Track): AutomationLane[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: AutomationLane[] = []
  for (const raw of v as Loose<AutomationLane>[]) {
    if (typeof raw?.target !== 'string' || seen.has(raw.target) || !resolveTarget(track, raw.target)) continue
    seen.add(raw.target)
    const points = (Array.isArray(raw.points) ? raw.points : [])
      .filter((p) => typeof p?.time === 'number' && Number.isFinite(p.time) && typeof p.value === 'number' && Number.isFinite(p.value))
      .map((p) => ({
        time: Math.max(0, p.time),
        value: Math.min(1, Math.max(0, p.value)),
        curve: Math.min(1, Math.max(-1, num(p.curve, 0))),
      }))
      .sort((a, b) => a.time - b.time)
    out.push({ target: raw.target, points })
  }
  return out
}

export function normalizeProject(input: unknown): Project {
  if (!input || typeof input !== 'object') throw new InvalidProjectError('Not a project.')
  const raw = input as Loose<Project>
  if (raw.version !== 1) throw new InvalidProjectError(`Unsupported project version: ${String(raw.version)}.`)
  if (!Array.isArray(raw.tracks)) throw new InvalidProjectError('The project has no track list.')
  const defaults = createProject()
  const buses = Array.isArray(raw.buses) ? raw.buses.map((b) => normalizeBus(b as Loose<Bus>)).filter((b) => b !== null) : []
  const busIds = new Set(buses.map((b) => b.id))
  const ts = (raw.timeSignature ?? {}) as Loose<Project['timeSignature']>
  const loop = (raw.loop ?? {}) as Loose<Project['loop']>
  const master = (raw.master ?? {}) as Loose<Project['master']>
  return {
    version: 1,
    id: str(raw.id, defaults.id),
    name: str(raw.name, defaults.name),
    bpm: num(raw.bpm, defaults.bpm),
    timeSignature: { beats: num(ts.beats, 4), unit: num(ts.unit, 4) },
    snap: raw.snap === 'off' || raw.snap === 'bar' ? raw.snap : 'beat',
    loop: { enabled: bool(loop.enabled), start: num(loop.start, 0), end: num(loop.end, 8) },
    master: { volume: num(master.volume, 1), muted: bool(master.muted), effects: effects(master.effects), fxBypass: bool(master.fxBypass) },
    tracks: raw.tracks.map((t) => normalizeTrack(t as Loose<Track>, busIds)).filter((t) => t !== null),
    buses,
    assets: raw.assets && typeof raw.assets === 'object' ? (raw.assets as Project['assets']) : {},
  }
}

/** Ids of the assets the project actually uses: audio clips and sampler instruments. */
export function usedAssetIds(project: Project): string[] {
  const ids = new Set<string>()
  for (const t of project.tracks) {
    for (const c of t.clips) if (!isMidiClip(c)) ids.add(c.assetId)
    if (t.instrument?.sample) ids.add(t.instrument.sample.assetId)
  }
  return [...ids]
}
