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

/** How synced audio clips follow the tempo: keeping their pitch, or like a record sped up. */
export type SyncMode = 'stretch' | 'resample'

export interface LoopRegion {
  enabled: boolean
  start: number
  end: number
}

export type TrackKind = 'audio' | 'midi' | 'drums'

interface ClipBase {
  id: Id
  name: string
  /** Timeline position where the clip begins. */
  start: number
  /** Where playback begins inside the clip's content (trimmed-off head). */
  offset: number
  /** Length of the clip on the timeline. */
  duration: number
  /** Linear gain applied to this clip (1 = 0 dB). */
  gain: number
  fadeIn: number
  fadeOut: number
}

/** A clip playing part of an audio asset. */
export interface AudioClip extends ClipBase {
  assetId: Id
  /**
   * The tempo the audio was made at. When set, the clip is synced: it plays at project BPM ÷
   * this, and keeps its place in bars when the tempo changes. `offset` is then in the audio's
   * own seconds, while `start`, `duration` and the fades are in timeline seconds.
   */
  sourceBpm?: number
}

/**
 * A note in a MIDI clip. Times are in beats (quarter notes) from the start of the clip's content
 * (the clip start minus its offset), so notes follow the tempo.
 */
export interface Note {
  id: Id
  /** MIDI note number, 0–127 (60 is middle C). */
  pitch: number
  start: number
  length: number
  /** 0–1. */
  velocity: number
}

/** A clip of notes, played by its track's instrument. */
export interface MidiClip extends ClipBase {
  notes: Note[]
}

export type Clip = AudioClip | MidiClip

export const isMidiClip = (clip: Clip): clip is MidiClip => 'notes' in clip

/** Note clips live on MIDI and drum tracks, audio clips on audio tracks. */
export const clipFitsTrack = (clip: Clip, track: Pick<Track, 'kind'>) => isMidiClip(clip) === (track.kind !== 'audio')

export type SynthPreset = 'keys' | 'pluck' | 'bass' | 'pad' | 'lead'

/** What a MIDI track plays its notes with: a built-in synth, or a sample pitched across the keys. */
export interface Instrument {
  type: SynthPreset | 'sampler'
  /** Sampler only: the audio asset, and the note at which it plays at its original pitch. */
  sample?: { assetId: Id; root: number }
  /** Portamento time in seconds; above 0 the instrument plays one note at a time and slides. */
  glide: number
}

/** Built-in synthesized drum sounds. */
export type DrumVoice =
  | 'kick'
  | 'sub'
  | 'snare'
  | 'clap'
  | 'rim'
  | 'hat-closed'
  | 'hat-open'
  | 'crash'
  | 'ride'
  | 'tom-low'
  | 'tom-mid'
  | 'tom-high'
  | 'cowbell'
  | 'shaker'
  | 'conga-low'
  | 'conga-high'

/**
 * One pad of a drum kit. Drum clips are note clips: a hit is a note on the pad's MIDI note
 * (General MIDI drum numbers), so drum MIDI files land on the right pads.
 */
export interface DrumPad {
  note: number
  name: string
  /** The synthesized sound, used when the pad has no sample. */
  voice: DrumVoice
  /** Pitch in semitones, -12…12. */
  tune: number
  /** Decay time multiplier for the synthesized sound, 0.25…4. */
  decay: number
  /** Linear gain, 0…2. */
  gain: number
  /** A one-shot that replaces the synthesized sound. */
  sample?: { assetId: Id }
}

export interface DrumKit {
  /** The preset the kit started from (shown as its name). */
  preset: string
  pads: DrumPad[]
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
  /** MIDI tracks only. */
  instrument?: Instrument
  /** Drum tracks only. */
  kit?: DrumKit
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

export type EffectType =
  // Batch 1: essentials.
  | 'eq'
  | 'compressor'
  | 'filter'
  | 'delay'
  | 'reverb'
  | 'saturation'
  | 'gate'
  // Batch 2: character and space.
  | 'chorus'
  | 'phaser'
  | 'tremolo'
  | 'vibrato'
  | 'tape'
  | 'bitcrusher'
  | 'clipper'
  | 'tilt'
  | 'air'
  | 'midside'
  | 'slapback'
  | 'plate'
  | 'spread'
  | 'duck'
  // Batch 3: specialist.
  | 'transient'
  | 'deesser'
  | 'opto'
  | 'doubler'
  | 'amp'
  | 'autotune'

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

export type LyricSectionKind = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'solo' | 'outro'

/** A part of the song's lyrics, in song order. */
export interface LyricSection {
  id: Id
  kind: LyricSectionKind
  text: string
}

export interface Project {
  version: 1
  id: Id
  name: string
  /** Tempo in quarter notes per minute. */
  bpm: number
  timeSignature: TimeSignature
  snap: SnapMode
  syncMode: SyncMode
  loop: LoopRegion
  master: MasterChannel
  tracks: Track[]
  buses: Bus[]
  assets: Record<Id, AssetMeta>
  lyrics: LyricSection[]
}
