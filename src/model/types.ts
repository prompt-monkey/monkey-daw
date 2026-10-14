// Project data model. Everything here is plain, serializable data: the audio engine and the
// UI derive their state from it, and the project file (later) is just this object as JSON.
//
// Time convention: all positions and lengths on the timeline are in seconds.

export type Id = string

export interface TimeSignature {
  /** Beats per bar (the top number: 6 in 6/8). */
  beats: number
  /** Note value of one beat (the bottom number: 8 in 6/8). */
  unit: number
}

export type SnapMode = 'off' | 'bar' | 'beat'

export interface LoopRegion {
  enabled: boolean
  start: number
  end: number
}

export type TrackKind = 'audio' | 'midi' | 'drums'

export interface Clip {
  id: Id
  name: string
  assetId: Id
  /** Timeline position where the clip begins. */
  start: number
  /** Where playback begins inside the asset (trimmed-off head). */
  offset: number
  /** Length of the clip on the timeline. */
  duration: number
  /** Linear gain applied to this clip (1 = 0 dB). */
  gain: number
  fadeIn: number
  fadeOut: number
}

export interface Track {
  id: Id
  name: string
  kind: TrackKind
  /** Linear fader gain (1 = 0 dB). */
  volume: number
  /** Stereo position, -1 (left) to 1 (right). */
  pan: number
  muted: boolean
  solo: boolean
  /** Where the track's signal goes after its fader: the master, or a bus id. */
  output: OutputTarget
  /** Post-fader sends to buses. */
  sends: Send[]
  /** Insert effects, in signal order (before the pan and fader). */
  effects: Effect[]
  /** Bypasses the whole effect chain. */
  fxBypass: boolean
  /** Automation lanes, at most one per target. */
  automation: AutomationLane[]
  clips: Clip[]
}

/**
 * What a lane controls: the track's volume or pan, or a numeric parameter of one of its effects.
 * Written as a key: 'volume', 'pan' or 'fx:<effectId>:<param>'.
 */
export type AutomationTarget = string

export interface AutomationPoint {
  time: number
  /**
   * Position on the control's own scale, 0–1 (the fader curve for volume, octaves for a
   * frequency…), so moves between points sound even.
   */
  value: number
  /** Bend of the segment to the next point, -1…1 (0 is a straight line). */
  curve: number
}

export interface AutomationLane {
  target: AutomationTarget
  /** Sorted by time. */
  points: AutomationPoint[]
}

export type EffectType = 'eq' | 'compressor' | 'filter' | 'delay' | 'reverb' | 'saturation' | 'gate'

/** Parameter values: numbers in real units (Hz, dB, ms…), choices as strings, toggles as booleans. */
export type EffectParams = Record<string, number | string | boolean>

export interface Effect {
  id: Id
  type: EffectType
  enabled: boolean
  params: EffectParams
}

export type OutputTarget = 'master' | Id

export interface Send {
  busId: Id
  /** Linear send level (1 = 0 dB). */
  level: number
}

/** A mix bus: tracks route or send into it, and it feeds the master. */
export interface Bus {
  id: Id
  name: string
  volume: number
  pan: number
  muted: boolean
  effects: Effect[]
  fxBypass: boolean
}

/** Metadata of an audio file used by the project. The decoded audio lives in the engine. */
export interface AssetMeta {
  id: Id
  name: string
  duration: number
  sampleRate: number
  channels: number
}

export interface MasterChannel {
  volume: number
  muted: boolean
  effects: Effect[]
  fxBypass: boolean
}

export interface Project {
  version: 1
  id: Id
  name: string
  /** Tempo in quarter notes per minute. */
  bpm: number
  timeSignature: TimeSignature
  snap: SnapMode
  loop: LoopRegion
  master: MasterChannel
  tracks: Track[]
  buses: Bus[]
  assets: Record<Id, AssetMeta>
}
