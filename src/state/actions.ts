// Named, undoable edits to the project. UI code calls these instead of mutating the store
// directly, so every change gets an undo label and gestures coalesce consistently.

import { createClip, createId, createTrack } from '../model/factory'
import type { AssetMeta, Clip, Id, Project, SnapMode, TimeSignature, Track } from '../model/types'
import { useProjectStore } from './projectStore'
import type { ClipboardItem } from './viewStore'

const update = (...args: Parameters<ReturnType<typeof useProjectStore.getState>['update']>) =>
  useProjectStore.getState().update(...args)

function findTrack(p: Project, trackId: Id): Track | undefined {
  return p.tracks.find((t) => t.id === trackId)
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function addTrack(index?: number) {
  update('Add track', (p) => {
    const track = createTrack(`Track ${p.tracks.length + 1}`)
    p.tracks.splice(index ?? p.tracks.length, 0, track)
  })
}

export function removeTrack(trackId: Id) {
  update('Delete track', (p) => {
    p.tracks = p.tracks.filter((t) => t.id !== trackId)
  })
}

export function renameTrack(trackId: Id, name: string) {
  update('Rename track', (p) => {
    const t = findTrack(p, trackId)
    if (t) t.name = name
  })
}

export function setTrackVolume(trackId: Id, volume: number) {
  update(
    'Change volume',
    (p) => {
      const t = findTrack(p, trackId)
      if (t) t.volume = clamp(volume, 0, 2)
    },
    `volume:${trackId}`,
  )
}

export function setTrackPan(trackId: Id, pan: number) {
  update(
    'Change pan',
    (p) => {
      const t = findTrack(p, trackId)
      if (t) t.pan = clamp(pan, -1, 1)
    },
    `pan:${trackId}`,
  )
}

export function toggleMute(trackId: Id) {
  update('Toggle mute', (p) => {
    const t = findTrack(p, trackId)
    if (t) t.muted = !t.muted
  })
}

export function toggleSolo(trackId: Id) {
  update('Toggle solo', (p) => {
    const t = findTrack(p, trackId)
    if (t) t.solo = !t.solo
  })
}

export function setMasterVolume(volume: number) {
  update('Change master volume', (p) => void (p.master.volume = clamp(volume, 0, 2)), 'volume:master')
}

export function setBpm(bpm: number) {
  update('Change tempo', (p) => void (p.bpm = clamp(Math.round(bpm * 100) / 100, 20, 300)), 'bpm')
}

export function setTimeSignature(timeSignature: TimeSignature) {
  update('Change time signature', (p) => void (p.timeSignature = timeSignature))
}

export function setSnap(snap: SnapMode) {
  update('Change snap', (p) => void (p.snap = snap))
}

export function setLoop(loop: Partial<Project['loop']>) {
  update('Change loop', (p) => {
    const next = { ...p.loop, ...loop }
    if (next.end <= next.start) next.end = next.start + 0.1
    p.loop = next
  })
}

/** Registers an audio asset and places it as a clip on a track. */
export function addAudioClip(trackId: Id, asset: AssetMeta, start: number) {
  update('Add clip', (p) => {
    const t = findTrack(p, trackId)
    if (!t) return
    p.assets[asset.id] = asset
    t.clips.push(createClip({ name: asset.name, assetId: asset.id, start: Math.max(0, start), duration: asset.duration }))
  })
}

/** Creates a new track (named after the asset) holding the asset as one clip. */
export function addTrackWithClip(asset: AssetMeta, start: number): Id {
  const track = createTrack(asset.name)
  track.clips.push(createClip({ name: asset.name, assetId: asset.id, start: Math.max(0, start), duration: asset.duration }))
  update('Import audio', (p) => {
    p.assets[asset.id] = asset
    p.tracks.push(track)
  })
  return track.id
}

export interface ClipEdit {
  clipId: Id
  /** Destination track; the clip moves there if it differs from its current track. */
  trackId: Id
  fields: Partial<Clip>
}

/** Applies the edits of one gesture (move, trim, fade, gain) as a single undo step. */
export function applyClipEdits(label: string, edits: ClipEdit[]) {
  update(label, (p) => {
    for (const edit of edits) {
      const source = p.tracks.find((t) => t.clips.some((c) => c.id === edit.clipId))
      const target = findTrack(p, edit.trackId)
      if (!source || !target) continue
      const index = source.clips.findIndex((c) => c.id === edit.clipId)
      const clip = source.clips[index]
      Object.assign(clip, edit.fields)
      if (source !== target) {
        source.clips.splice(index, 1)
        target.clips.push(clip)
      }
    }
  })
}

export function deleteClips(clipIds: Id[]) {
  if (!clipIds.length) return
  const ids = new Set(clipIds)
  update(clipIds.length > 1 ? 'Delete clips' : 'Delete clip', (p) => {
    for (const t of p.tracks) t.clips = t.clips.filter((c) => !ids.has(c.id))
  })
}

/** Places copies of the given clips at `at`, keeping their relative timing. Returns the new ids. */
export function pasteClips(items: ClipboardItem[], at: number, label = 'Paste'): Id[] {
  if (!items.length) return []
  const earliest = Math.min(...items.map((i) => i.clip.start))
  const copies = items.map((i) => ({
    trackId: i.trackId,
    clip: { ...i.clip, id: createId('clp'), start: Math.max(0, at + i.clip.start - earliest) },
  }))
  update(label, (p) => {
    for (const { trackId, clip } of copies) (findTrack(p, trackId) ?? p.tracks[0])?.clips.push(clip)
  })
  return copies.map((c) => c.clip.id)
}

/** Clips with their track, in the order given. Unknown ids are skipped. */
export function clipboardItems(p: Project, clipIds: Id[]): ClipboardItem[] {
  const items: ClipboardItem[] = []
  for (const id of clipIds) {
    for (const t of p.tracks) {
      const clip = t.clips.find((c) => c.id === id)
      if (clip) items.push({ clip, trackId: t.id })
    }
  }
  return items
}

/** Copies the clips right after the end of the group. Returns the new ids. */
export function duplicateClips(clipIds: Id[]): Id[] {
  const items = clipboardItems(useProjectStore.getState().project, clipIds)
  if (!items.length) return []
  const start = Math.min(...items.map((i) => i.clip.start))
  const end = Math.max(...items.map((i) => i.clip.start + i.clip.duration))
  return pasteClips(items, start + (end - start), items.length > 1 ? 'Duplicate clips' : 'Duplicate clip')
}
