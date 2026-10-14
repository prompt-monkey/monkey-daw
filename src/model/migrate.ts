// Turns stored or imported project data into a valid current Project, filling in fields that
// older data may lack. Anything that can't be repaired is rejected.

import { normalizeEffect } from '../effects/definitions'
import { createProject } from './factory'
import type { Bus, Clip, Effect, Project, Track } from './types'

export class InvalidProjectError extends Error {}

type Loose<T> = Partial<T> & Record<string, unknown>

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)
const bool = (v: unknown) => v === true

/** Valid effects only; unknown types (e.g. from a newer version) are dropped. */
const effects = (v: unknown): Effect[] => (Array.isArray(v) ? v.map(normalizeEffect).filter((e) => e !== null) : [])

function normalizeClip(raw: Loose<Clip>): Clip | null {
  if (typeof raw.id !== 'string' || typeof raw.assetId !== 'string') return null
  const duration = num(raw.duration, 0)
  if (duration <= 0) return null
  return {
    id: raw.id,
    name: str(raw.name, 'Clip'),
    assetId: raw.assetId,
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
  const clips = Array.isArray(raw.clips) ? raw.clips.map((c) => normalizeClip(c as Loose<Clip>)).filter((c) => c !== null) : []
  return {
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
    clips,
  }
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

/** Ids of the assets the project's clips actually use. */
export function usedAssetIds(project: Project): string[] {
  return [...new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))]
}
