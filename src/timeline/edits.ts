// Pure clip-editing math used by timeline gestures. Every function returns the changed clip
// fields; the drag controller previews them and commits them as one undoable action.

import type { Clip, Id, Track } from '../model/types'

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
 * their distance from it. Nothing moves before time 0 or off the first/last track.
 */
export function moveClips(
  group: ClipPlacement[],
  grabbed: Clip,
  rawDelta: number,
  rawTrackDelta: number,
  trackIds: Id[],
  snap: SnapFn,
): ClipPreview {
  let delta = snap(grabbed.start + rawDelta) - grabbed.start
  const earliest = Math.min(...group.map((g) => g.clip.start))
  delta = Math.max(delta, -earliest)
  const indices = group.map((g) => g.trackIndex)
  const trackDelta = Math.min(Math.max(rawTrackDelta, -Math.min(...indices)), trackIds.length - 1 - Math.max(...indices))
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

/** Moves the clip's left edge, keeping its right edge (and the audio under it) in place. */
export function trimStart(clip: Clip, newStart: number): Partial<Clip> {
  const earliest = Math.max(0, clip.start - clip.offset)
  const latest = clip.start + clip.duration - MIN_CLIP_DURATION
  const start = Math.min(latest, Math.max(earliest, newStart))
  const shift = start - clip.start
  const duration = clip.duration - shift
  return { start, offset: clip.offset + shift, duration, ...fitFades(clip.fadeIn, clip.fadeOut, duration) }
}

/** Moves the clip's right edge, up to the end of its audio. */
export function trimEnd(clip: Clip, assetDuration: number, newEnd: number): Partial<Clip> {
  const latest = clip.start + Math.max(MIN_CLIP_DURATION, assetDuration - clip.offset)
  const end = Math.min(latest, Math.max(clip.start + MIN_CLIP_DURATION, newEnd))
  const duration = end - clip.start
  return { duration, ...fitFades(clip.fadeIn, clip.fadeOut, duration) }
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
