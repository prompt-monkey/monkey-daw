import { createKit } from '../drums/kits'
import type { AudioClip, Bus, Id, Instrument, MidiClip, Project, Track, TrackKind } from './types'

export function createId(prefix: string): Id {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

export function createTrack(name: string, kind: TrackKind = 'audio'): Track {
  return {
    id: createId('trk'),
    name,
    kind,
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    output: 'master',
    sends: [],
    effects: [],
    fxBypass: false,
    automation: [],
    ...(kind === 'midi' ? { instrument: createInstrument() } : {}),
    ...(kind === 'drums' ? { kit: createKit() } : {}),
    clips: [],
  }
}

export function createInstrument(type: Instrument['type'] = 'keys'): Instrument {
  return { type, glide: 0 }
}

export function createBus(name: string): Bus {
  return { id: createId('bus'), name, volume: 1, pan: 0, muted: false, effects: [], fxBypass: false }
}

export function createClip(fields: Pick<AudioClip, 'name' | 'assetId' | 'start' | 'duration'> & Partial<AudioClip>): AudioClip {
  return { id: createId('clp'), offset: 0, gain: 1, fadeIn: 0, fadeOut: 0, ...fields }
}

export function createMidiClip(fields: Pick<MidiClip, 'start' | 'duration'> & Partial<MidiClip>): MidiClip {
  return { id: createId('clp'), name: 'MIDI clip', offset: 0, gain: 1, fadeIn: 0, fadeOut: 0, notes: [], ...fields }
}

export function createProject(name = 'Untitled project'): Project {
  return {
    version: 1,
    id: createId('prj'),
    name,
    bpm: 120,
    timeSignature: { beats: 4, unit: 4 },
    snap: 'beat',
    loop: { enabled: false, start: 0, end: 8 },
    master: { volume: 1, muted: false, effects: [], fxBypass: false },
    tracks: [1, 2, 3, 4].map((n) => createTrack(`Track ${n}`)),
    buses: [],
    assets: {},
  }
}

/** End of the last clip on the timeline, in seconds. */
export function projectLength(project: Project): number {
  let end = 0
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration)
  }
  return end
}
