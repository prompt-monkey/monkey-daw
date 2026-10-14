// Named, undoable edits to the project. UI code calls these instead of mutating the store
// directly, so every change gets an undo label and gestures coalesce consistently.

import { createClip, createTrack } from '../model/factory'
import type { AssetMeta, Id, Project, SnapMode, TimeSignature, Track } from '../model/types'
import { useProjectStore } from './projectStore'

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

export function moveClip(trackId: Id, clipId: Id, start: number) {
  update(
    'Move clip',
    (p) => {
      const c = findTrack(p, trackId)?.clips.find((c) => c.id === clipId)
      if (c) c.start = Math.max(0, start)
    },
    `move:${clipId}`,
  )
}

export function removeClip(trackId: Id, clipId: Id) {
  update('Delete clip', (p) => {
    const t = findTrack(p, trackId)
    if (t) t.clips = t.clips.filter((c) => c.id !== clipId)
  })
}
