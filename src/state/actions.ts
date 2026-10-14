// Named, undoable edits to the project. UI code calls these instead of mutating the store
// directly, so every change gets an undo label and gestures coalesce consistently.

import { current } from 'immer'
import { createBus, createClip, createId, createTrack } from '../model/factory'
import { MAX_GAIN } from '../model/levels'
import type { AssetMeta, Bus, Clip, Id, OutputTarget, Project, SnapMode, TimeSignature, Track } from '../model/types'
import { useProjectStore } from './projectStore'
import type { ClipboardItem } from './viewStore'

const update = (...args: Parameters<ReturnType<typeof useProjectStore.getState>['update']>) =>
  useProjectStore.getState().update(...args)

function findTrack(p: Project, trackId: Id): Track | undefined {
  return p.tracks.find((t) => t.id === trackId)
}

/** A track or a bus: both have volume, pan and mute. */
function findChannel(p: Project, channelId: Id): Track | Bus | undefined {
  return findTrack(p, channelId) ?? p.buses.find((b) => b.id === channelId)
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

/** Copies a track with its clips, routing and sends, right below the original. */
export function duplicateTrack(trackId: Id) {
  update('Duplicate track', (p) => {
    const index = p.tracks.findIndex((t) => t.id === trackId)
    if (index < 0) return
    const source = p.tracks[index]
    const copy: Track = {
      ...structuredClone(current(source)),
      id: createId('trk'),
      name: `${source.name} copy`,
      solo: false,
    }
    copy.clips = copy.clips.map((c) => ({ ...c, id: createId('clp') }))
    p.tracks.splice(index + 1, 0, copy)
  })
}

/** Moves a track to a new position in the list. */
export function moveTrack(trackId: Id, toIndex: number) {
  update('Reorder tracks', (p) => {
    const from = p.tracks.findIndex((t) => t.id === trackId)
    if (from < 0) return
    const [track] = p.tracks.splice(from, 1)
    p.tracks.splice(clamp(toIndex, 0, p.tracks.length), 0, track)
  })
}

export function renameTrack(trackId: Id, name: string) {
  update('Rename track', (p) => {
    const t = findTrack(p, trackId)
    if (t) t.name = name
  })
}

export function setVolume(channelId: Id, volume: number) {
  update(
    'Change volume',
    (p) => {
      const c = findChannel(p, channelId)
      if (c) c.volume = clamp(volume, 0, MAX_GAIN)
    },
    `volume:${channelId}`,
  )
}

export function setPan(channelId: Id, pan: number) {
  update(
    'Change pan',
    (p) => {
      const c = findChannel(p, channelId)
      if (c) c.pan = clamp(pan, -1, 1)
    },
    `pan:${channelId}`,
  )
}

export function toggleMute(channelId: Id) {
  update('Toggle mute', (p) => {
    const c = findChannel(p, channelId)
    if (c) c.muted = !c.muted
  })
}

export function toggleSolo(trackId: Id) {
  update('Toggle solo', (p) => {
    const t = findTrack(p, trackId)
    if (t) t.solo = !t.solo
  })
}

export function setMasterVolume(volume: number) {
  update('Change master volume', (p) => void (p.master.volume = clamp(volume, 0, MAX_GAIN)), 'volume:master')
}

export function toggleMasterMute() {
  update('Toggle master mute', (p) => void (p.master.muted = !p.master.muted))
}

/** Adds a bus and returns its id. */
export function addBus(): Id {
  const n = useProjectStore.getState().project.buses.length + 1
  const bus = createBus(`Bus ${n}`)
  update('Add bus', (p) => void p.buses.push(bus))
  return bus.id
}

/** Deletes a bus; tracks routed to it go back to the master and their sends to it are removed. */
export function removeBus(busId: Id) {
  update('Delete bus', (p) => {
    p.buses = p.buses.filter((b) => b.id !== busId)
    for (const t of p.tracks) {
      if (t.output === busId) t.output = 'master'
      t.sends = t.sends.filter((s) => s.busId !== busId)
    }
  })
}

export function renameBus(busId: Id, name: string) {
  update('Rename bus', (p) => {
    const b = p.buses.find((b) => b.id === busId)
    if (b) b.name = name
  })
}

export function setTrackOutput(trackId: Id, output: OutputTarget) {
  update('Change output', (p) => {
    const t = findTrack(p, trackId)
    if (!t || (output !== 'master' && !p.buses.some((b) => b.id === output))) return
    t.output = output
  })
}

/** Sets a post-fader send level; level 0 removes the send. */
export function setSend(trackId: Id, busId: Id, level: number) {
  update(
    'Change send',
    (p) => {
      const t = findTrack(p, trackId)
      if (!t || !p.buses.some((b) => b.id === busId)) return
      const value = clamp(level, 0, MAX_GAIN)
      const send = t.sends.find((s) => s.busId === busId)
      if (value === 0) t.sends = t.sends.filter((s) => s.busId !== busId)
      else if (send) send.level = value
      else t.sends.push({ busId, level: value })
    },
    `send:${trackId}:${busId}`,
  )
}

export function renameProject(name: string) {
  const trimmed = name.trim()
  if (trimmed) update('Rename project', (p) => void (p.name = trimmed))
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
export function addAudioClip(trackId: Id, asset: AssetMeta, start: number, label = 'Add clip') {
  update(label, (p) => {
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
