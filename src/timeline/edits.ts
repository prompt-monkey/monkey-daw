// Pure clip-editing math used by timeline gestures. Every function returns the changed clip
// fields; the drag controller previews them and commits them as one undoable action.

import { MAX_SOURCE_BPM, MIN_SOURCE_BPM } from '../model/tempo'
import type { Clip, Id, Track, TrackKind } from '../model/types'

/** Shortest clip a trim can produce, in seconds. */
export const MIN_CLIP_DURATION = 0.02
export const MAX_CLIP_GAIN = 2

type SnapFn = (seconds: number) => number

export interface ClipPlacement {
  clip: Clip
  trackIndex: number
}

export interface PreviewEntry {
  trackId: Id
  fields: Partial<Clip>
}

/** Pending edits of a gesture, keyed by clip id. */
export type ClipPreview = Record<Id, PreviewEntry>

/**
 * Moves a group of clips together. The grabbed clip's start snaps to the grid; the others keep
 * their distance from it. Nothing moves before time 0 or off the first/last track, and clips only
 * change track when every clip of the group lands on a track of the same kind (`trackKinds`).
 */
export function moveClips(
  group: ClipPlacement[],
  grabbed: Clip,
  rawDelta: number,
  rawTrackDelta: number,
  trackIds: Id[],
  snap: SnapFn,
  trackKinds?: TrackKind[],
): ClipPreview {
  let delta = snap(grabbed.start + rawDelta) - grabbed.start
  const earliest = Math.min(...group.map((g) => g.clip.start))
  delta = Math.max(delta, -earliest)
  const indices = group.map((g) => g.trackIndex)
  let trackDelta = Math.min(Math.max(rawTrackDelta, -Math.min(...indices)), trackIds.length - 1 - Math.max(...indices))
  if (trackKinds && group.some((g) => trackKinds[g.trackIndex + trackDelta] !== trackKinds[g.trackIndex])) trackDelta = 0
  const preview: ClipPreview = {}
  for (const { clip, trackIndex } of group) {
    preview[clip.id] = { trackId: trackIds[trackIndex + trackDelta], fields: { start: clip.start + delta } }
  }
  return preview
}

function fitFades(fadeIn: number, fadeOut: number, duration: number): Pick<Clip, 'fadeIn' | 'fadeOut'> {
  const fi = Math.min(fadeIn, duration)
  return { fadeIn: fi, fadeOut: Math.min(fadeOut, duration - fi) }
}

/** How a clip's audio lines up with the timeline, for trimming. */
export interface TrimContext {
  /** Audio seconds per timeline second (synced clips). */
  rate?: number
  /** A reversed clip shows its audio's end at its left edge. */
  reversed?: boolean
  assetDuration?: number
}

/**
 * Moves the clip's left edge, keeping its right edge (and the audio under it) in place. The
 * audio the edge can reveal is what comes before the window, or after it when reversed.
 */
export function trimStart(clip: Clip, newStart: number, { rate = 1, reversed = false, assetDuration = Infinity }: TrimContext = {}): Partial<Clip> {
  const spare = reversed ? assetDuration - clip.offset - clip.duration * rate : clip.offset
  const earliest = Math.max(0, clip.start - spare / rate)
  const latest = clip.start + clip.duration - MIN_CLIP_DURATION
  const start = Math.min(latest, Math.max(earliest, newStart))
  const shift = start - clip.start
  const duration = clip.duration - shift
  // Backwards, the left edge is the window's end: the offset stays put.
  const offset = reversed ? clip.offset : clip.offset + shift * rate
  return { start, offset, duration, ...fitFades(clip.fadeIn, clip.fadeOut, duration) }
}

/** Moves the clip's right edge, up to the end of its audio (its start when reversed). */
export function trimEnd(clip: Clip, newEnd: number, { rate = 1, reversed = false, assetDuration = Infinity }: TrimContext = {}): Partial<Clip> {
  const spare = reversed ? clip.offset : assetDuration - clip.offset - clip.duration * rate
  // A window already past the audio's end is pulled back to it.
  const latest = clip.start + Math.max(MIN_CLIP_DURATION, clip.duration + spare / rate)
  const end = Math.min(latest, Math.max(clip.start + MIN_CLIP_DURATION, newEnd))
  const duration = end - clip.start
  const fields: Partial<Clip> = { duration, ...fitFades(clip.fadeIn, clip.fadeOut, duration) }
  // Backwards, the right edge is the window's start: moving it moves the offset.
  if (reversed) fields.offset = Math.max(0, clip.offset - (end - clip.start - clip.duration) * rate)
  return fields
}

export function setFadeIn(clip: Clip, fadeIn: number): Partial<Clip> {
  return { fadeIn: Math.min(clip.duration - clip.fadeOut, Math.max(0, fadeIn)) }
}

export function setFadeOut(clip: Clip, fadeOut: number): Partial<Clip> {
  return { fadeOut: Math.min(clip.duration - clip.fadeIn, Math.max(0, fadeOut)) }
}

export function setGain(gain: number): Partial<Clip> {
  return { gain: Math.min(MAX_CLIP_GAIN, Math.max(0, gain)) }
}

/** Tracks as they look with a gesture's preview applied (clips may change tracks). */
export function applyPreview(tracks: Track[], preview: ClipPreview | null): Track[] {
  if (!preview || Object.keys(preview).length === 0) return tracks
  const moved = new Map<Id, Clip[]>()
  for (const track of tracks) {
    for (const clip of track.clips) {
      const entry = preview[clip.id]
      const target = entry ? entry.trackId : track.id
      const list = moved.get(target) ?? []
      list.push(entry ? { ...clip, ...entry.fields } : clip)
      moved.set(target, list)
    }
  }
  return tracks.map((t) => ({ ...t, clips: moved.get(t.id) ?? [] }))
}

/** Ids of clips touching a time range on a range of tracks (both ranges in any order). */
export function clipsInRect(tracks: Track[], t0: number, t1: number, track0: number, track1: number): Id[] {
  const [from, to] = t0 <= t1 ? [t0, t1] : [t1, t0]
  const [first, last] = track0 <= track1 ? [track0, track1] : [track1, track0]
  const ids: Id[] = []
  tracks.slice(Math.max(0, first), last + 1).forEach((t) => {
    for (const c of t.clips) if (c.start < to && c.start + c.duration > from) ids.push(c.id)
  })
  return ids
}

/** Gain shown in dB, e.g. "+2.5 dB", "-inf dB". */
export function formatGain(gain: number): string {
  if (gain <= 0.0001) return '-inf dB'
  const db = 20 * Math.log10(gain)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

/**
 * Cuts a clip in two at timeline time `at`: the left part keeps the fade-in, the right part the
 * fade-out. Note clips keep the notes that start in each part (note times stay relative to the
 * content's start, so they don't move). Returns null when `at` isn't inside the clip.
 */
export function splitClip(clip: Clip, at: number, { rate = 1, reversed = false }: Pick<TrimContext, 'rate' | 'reversed'> = {}, bpm = 120): [Partial<Clip>, Clip] | null {
  const leftDuration = at - clip.start
  const rightDuration = clip.start + clip.duration - at
  if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) return null
  const left: Partial<Clip> = { duration: leftDuration, fadeIn: Math.min(clip.fadeIn, leftDuration), fadeOut: 0, fadeOutCurve: undefined }
  // Backwards, the left part plays the end of the window: its offset moves, the right part's stays.
  if (reversed) left.offset = clip.offset + rightDuration * rate
  const right = {
    ...clip,
    start: at,
    duration: rightDuration,
    offset: reversed ? clip.offset : clip.offset + leftDuration * rate,
    fadeIn: 0,
    fadeInCurve: undefined,
    fadeOut: Math.min(clip.fadeOut, rightDuration),
  } as Clip
  if ('notes' in clip) {
    // The cut in beats from the content's start (the clip start minus its offset).
    const cut = (at - clip.start + clip.offset) / (60 / bpm)
    ;(left as Partial<typeof clip>).notes = clip.notes.filter((n) => n.start < cut - 1e-9)
    ;(right as typeof clip).notes = clip.notes.filter((n) => n.start >= cut - 1e-9)
  }
  return [left, right]
}

/** The slowest and fastest a clip can be stretched to, relative to its audio's own speed. */
export const STRETCH_LIMITS = { min: 0.25, max: 4 }

/**
 * Moves an audio clip's right edge by stretching its audio to fit, without changing pitch: the
 * same audio plays over the new length (it becomes synced to the tempo, so it stays in bars).
 * Returns null for note clips.
 */
export function stretchEnd(clip: Clip, newEnd: number, bpm: number, rate = 1): Partial<Clip> | null {
  if ('notes' in clip) return null
  // How much audio the clip plays now; the new rate plays that much over the new length.
  const audio = clip.duration * rate
  // Within the stretch limits, and within the tempos a synced clip can have (sourceBpm = bpm ×
  // duration ÷ audio).
  const minDuration = Math.max(audio / STRETCH_LIMITS.max, (audio * MIN_SOURCE_BPM) / bpm)
  const maxDuration = Math.min(audio / STRETCH_LIMITS.min, (audio * MAX_SOURCE_BPM) / bpm)
  const duration = Math.min(maxDuration, Math.max(Math.max(MIN_CLIP_DURATION, minDuration), newEnd - clip.start))
  const k = duration / clip.duration
  return {
    duration,
    sourceBpm: bpm / (audio / duration),
    fadeIn: clip.fadeIn * k,
    fadeOut: clip.fadeOut * k,
  }
}
