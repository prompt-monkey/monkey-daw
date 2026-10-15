// Named, undoable edits to the project. UI code calls these instead of mutating the store
// directly, so every change gets an undo label and gestures coalesce consistently.

import { current } from 'immer'
import { createBus, createClip, createId, createMidiClip, createTrack } from '../model/factory'
import { createKit } from '../drums/kits'
import { secondsPerBar } from '../model/grid'
import { beatSeconds, notesEnd, sortNotes } from '../model/midi'
import { MAX_PITCH_SHIFT, MAX_SOURCE_BPM, MIN_SOURCE_BPM, clipRate, detectBpm } from '../model/tempo'
import { MAX_GAIN } from '../model/levels'
import { EFFECTS, createEffect, findParam, normalizeParam } from '../effects/definitions'
import { insertPoint } from '../automation/curve'
import { effectTarget, resolveTarget } from '../automation/targets'
import { writeAutomation } from '../automation/write'
import {
  clipFitsTrack,
  isMidiClip,
  type AssetMeta,
  type AutomatedChannel,
  type AutomationLane,
  type AutomationPoint,
  type AutomationTarget,
  type Bus,
  type AudioClip,
  type Clip,
  type DrumPad,
  type Effect,
  type EffectParams,
  type EffectType,
  type Id,
  type Instrument,
  type LyricSectionKind,
  type MidiClip,
  type Note,
  type OutputTarget,
  type PitchEdit,
  type Project,
  type SnapMode,
  type SyncMode,
  type SynthPreset,
  type TimeSignature,
  type Track,
  type TrackKind,
} from '../model/types'
import { splitClip } from '../timeline/edits'
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

/** Adds a track (at the end by default) and returns its id. */
export function addTrack(index?: number, kind: TrackKind = 'audio'): Id {
  const n = useProjectStore.getState().project.tracks.length + 1
  const names = { audio: ['Track', 'Add track'], midi: ['MIDI', 'Add MIDI track'], drums: ['Drums', 'Add drum track'] }
  const [name, label] = names[kind]
  const track = createTrack(`${name} ${n}`, kind)
  update(label, (p) => {
    p.tracks.splice(index ?? p.tracks.length, 0, track)
  })
  return track.id
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

// Volume, pan and effect knobs also record automation while writing (see automation/write.ts).

export function setVolume(channelId: Id, volume: number) {
  const value = clamp(volume, 0, MAX_GAIN)
  const apply = (p: Project) => {
    const c = findChannel(p, channelId)
    if (c) c.volume = value
  }
  if (!writeAutomation(channelId, 'volume', value, apply)) update('Change volume', apply, `volume:${channelId}`)
}

export function setPan(channelId: Id, pan: number) {
  const value = clamp(pan, -1, 1)
  const apply = (p: Project) => {
    const c = findChannel(p, channelId)
    if (c) c.pan = value
  }
  if (!writeAutomation(channelId, 'pan', value, apply)) update('Change pan', apply, `pan:${channelId}`)
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
  const value = clamp(volume, 0, MAX_GAIN)
  const apply = (p: Project) => void (p.master.volume = value)
  if (!writeAutomation('master', 'volume', value, apply)) update('Change master volume', apply, 'volume:master')
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

/**
 * Changes the tempo. Note clips and synced audio clips keep their place in bars and beats: their
 * position, length and fades scale with the tempo (a synced clip's audio plays faster or slower
 * to fill it). Other audio clips stay where they are.
 */
export function setBpm(bpm: number) {
  update(
    'Change tempo',
    (p) => {
      const next = clamp(Math.round(bpm * 100) / 100, 20, 300)
      const ratio = p.bpm / next
      p.bpm = next
      if (ratio === 1) return
      for (const t of p.tracks) {
        for (const c of t.clips) {
          if (!isMidiClip(c) && !c.sourceBpm) continue
          c.start *= ratio
          // A synced clip's offset is in its audio's own seconds, which don't change.
          if (isMidiClip(c)) c.offset *= ratio
          c.duration *= ratio
          c.fadeIn *= ratio
          c.fadeOut *= ratio
        }
      }
    },
    'bpm',
  )
}

export function setTimeSignature(timeSignature: TimeSignature) {
  update('Change time signature', (p) => void (p.timeSignature = timeSignature))
}

export function setSyncMode(syncMode: SyncMode) {
  update('Change tempo sync', (p) => void (p.syncMode = syncMode))
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

/**
 * A clip playing a whole asset from `start`. If the asset's name gives its tempo (e.g.
 * "Loop 95 BPM"), the clip is synced to the project tempo.
 */
function clipForAsset(asset: AssetMeta, start: number, bpm: number) {
  const sourceBpm = detectBpm(asset.name, asset.duration)
  const rate = sourceBpm ? bpm / sourceBpm : 1
  return createClip({
    name: asset.name,
    assetId: asset.id,
    start: Math.max(0, start),
    duration: asset.duration / rate,
    ...(sourceBpm ? { sourceBpm } : {}),
  })
}

/** Registers an audio asset and places it as a clip on an audio track. */
export function addAudioClip(trackId: Id, asset: AssetMeta, start: number, label = 'Add clip') {
  update(label, (p) => {
    const t = findTrack(p, trackId)
    if (!t || t.kind !== 'audio') return
    p.assets[asset.id] = asset
    t.clips.push(clipForAsset(asset, start, p.bpm))
  })
}

/**
 * Swaps the audio an audio clip plays for another asset, keeping its place, gain and fades. The
 * clip keeps its length unless the new audio is shorter.
 */
export function replaceClipAudio(clipId: Id, asset: AssetMeta) {
  update('Replace audio', (p) => {
    const clip = findAudioClip(p, clipId)
    if (!clip) return
    p.assets[asset.id] = asset
    const fresh = clipForAsset(asset, clip.start, p.bpm)
    const duration = Math.min(clip.duration, fresh.duration)
    Object.assign(clip, { assetId: asset.id, name: fresh.name, offset: 0, duration })
    clip.fadeIn = Math.min(clip.fadeIn, duration)
    clip.fadeOut = Math.min(clip.fadeOut, duration - clip.fadeIn)
    if (fresh.sourceBpm) clip.sourceBpm = fresh.sourceBpm
    else delete clip.sourceBpm
    delete clip.pitchSource
  })
}

/** Creates a new track (named after the asset) holding the asset as one clip. */
export function addTrackWithClip(asset: AssetMeta, start: number): Id {
  const track = createTrack(asset.name)
  track.clips.push(clipForAsset(asset, start, useProjectStore.getState().project.bpm))
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
    for (const { trackId, clip } of copies) {
      const own = findTrack(p, trackId)
      const target = own && clipFitsTrack(clip, own) ? own : p.tracks.find((t) => clipFitsTrack(clip, t))
      target?.clips.push(clip)
    }
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

/** Cuts the given clips at `at` (those it falls inside). Returns the ids of the right-hand parts. */
export function splitClips(clipIds: Id[], at: number): Id[] {
  const ids = new Set(clipIds)
  const created: Id[] = []
  update(clipIds.length > 1 ? 'Split clips' : 'Split clip', (p) => {
    for (const t of p.tracks) {
      for (const clip of [...t.clips]) {
        if (!ids.has(clip.id)) continue
        const reversed = !isMidiClip(clip) && clip.reversed === true
        const parts = splitClip(current(clip), at, { rate: clipRate(clip, p.bpm), reversed }, p.bpm)
        if (!parts) continue
        const [left, right] = parts
        Object.assign(clip, left)
        if (clip.fadeOutCurve === undefined) delete clip.fadeOutCurve
        const copy = { ...right, id: createId('clp') }
        if (copy.fadeInCurve === undefined) delete copy.fadeInCurve
        if (isMidiClip(copy)) copy.notes = copy.notes.map((n) => ({ ...n, id: createId('note') }))
        t.clips.push(copy)
        created.push(copy.id)
      }
    }
  })
  return created
}

/** Copies the clips right after the end of the group. Returns the new ids. */
export function duplicateClips(clipIds: Id[]): Id[] {
  const items = clipboardItems(useProjectStore.getState().project, clipIds)
  if (!items.length) return []
  const start = Math.min(...items.map((i) => i.clip.start))
  const end = Math.max(...items.map((i) => i.clip.start + i.clip.duration))
  return pasteClips(items, start + (end - start), items.length > 1 ? 'Duplicate clips' : 'Duplicate clip')
}

// --- MIDI ----------------------------------------------------------------------------------

function findMidiClip(p: Project, clipId: Id): { track: Track; clip: MidiClip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip && isMidiClip(clip)) return { track, clip }
  }
  return undefined
}

/** Adds an empty note clip (one bar by default) to a MIDI or drum track. Returns its id. */
export function addMidiClip(trackId: Id, start: number, duration?: number): Id | null {
  const { project } = useProjectStore.getState()
  const track = findTrack(project, trackId)
  if (!track || track.kind === 'audio') return null
  const clip = createMidiClip({
    name: track.name,
    start: Math.max(0, start),
    duration: duration ?? secondsPerBar(project.bpm, project.timeSignature),
  })
  update('Add MIDI clip', (p) => void findTrack(p, trackId)?.clips.push(clip))
  return clip.id
}

/**
 * Replaces a MIDI clip's notes (kept sorted). If notes reach past the clip's end, the clip grows
 * to the next bar line. Pass a coalesce key so a drag is one undo step (end it with endGesture).
 */
export function setClipNotes(clipId: Id, notes: Note[], label: string, coalesceKey?: string) {
  update(
    label,
    (p) => {
      const found = findMidiClip(p, clipId)
      if (!found) return
      const { clip } = found
      clip.notes = sortNotes(notes)
      const spb = beatSeconds(p.bpm)
      const needed = notesEnd(clip.notes) * spb - clip.offset
      if (needed > clip.duration + 1e-6) {
        const bar = secondsPerBar(p.bpm, p.timeSignature)
        const contentStart = clip.start - clip.offset
        // Round the new clip end up to a bar line of the timeline.
        const end = Math.ceil((contentStart + notesEnd(clip.notes) * spb) / bar - 1e-6) * bar
        clip.duration = Math.max(clip.duration, end - clip.start)
      }
    },
    coalesceKey,
  )
}

export function setInstrument(trackId: Id, changes: Partial<Instrument>, label = 'Change instrument') {
  update(
    label,
    (p) => {
      const t = findTrack(p, trackId)
      if (!t?.instrument) return
      Object.assign(t.instrument, changes)
      if (t.instrument.type === 'sampler' && !t.instrument.sample) t.instrument.type = 'keys'
    },
    'glide' in changes ? `glide:${trackId}` : undefined,
  )
}

/** Uses an audio asset as a MIDI track's sampler, played at its own pitch on `root`. */
export function setSamplerSample(trackId: Id, asset: AssetMeta, root = 60) {
  update('Set sampler sample', (p) => {
    const t = findTrack(p, trackId)
    if (!t?.instrument) return
    p.assets[asset.id] = asset
    t.instrument.type = 'sampler'
    t.instrument.sample = { assetId: asset.id, root }
  })
}

/**
 * Sets the tempo an audio clip was made at, which syncs it to the project tempo (null stops
 * syncing). The clip keeps the same stretch of audio, so its length on the timeline changes.
 */
export function setClipSourceBpm(clipId: Id, sourceBpm: number | null) {
  if (sourceBpm !== null && !(sourceBpm >= MIN_SOURCE_BPM && sourceBpm <= MAX_SOURCE_BPM)) return
  update(sourceBpm ? 'Sync clip to tempo' : 'Stop syncing clip', (p) => {
    for (const t of p.tracks) {
      const clip = t.clips.find((c) => c.id === clipId)
      if (!clip || isMidiClip(clip)) continue
      const before = clipRate(clip, p.bpm)
      const after = sourceBpm ? p.bpm / sourceBpm : 1
      const k = before / after
      clip.duration *= k
      clip.fadeIn *= k
      clip.fadeOut *= k
      if (sourceBpm) clip.sourceBpm = sourceBpm
      else delete clip.sourceBpm
    }
  })
}

/** Finds an audio clip by id, for edits that only apply to audio. */
function findAudioClip(p: Project, clipId: Id): AudioClip | undefined {
  for (const t of p.tracks) {
    const clip = t.clips.find((c) => c.id === clipId)
    if (clip && !isMidiClip(clip)) return clip
  }
  return undefined
}

/** Plays audio clips backwards (or forwards again). */
export function setClipsReversed(clipIds: Id[], reversed: boolean) {
  update(reversed ? 'Reverse clip' : 'Unreverse clip', (p) => {
    for (const id of clipIds) {
      const clip = findAudioClip(p, id)
      if (!clip) continue
      if (reversed) clip.reversed = true
      else delete clip.reversed
    }
  })
}

/** Shifts audio clips' pitch, in semitones, without changing their length (0 removes it). */
export function setClipsPitch(clipIds: Id[], semitones: number) {
  const value = Math.round(clamp(semitones, -MAX_PITCH_SHIFT, MAX_PITCH_SHIFT) * 100) / 100
  update('Change clip pitch', (p) => {
    for (const id of clipIds) {
      const clip = findAudioClip(p, id)
      if (!clip) continue
      if (value) clip.pitch = value
      else delete clip.pitch
    }
  })
}

/**
 * Replaces clips with one audio clip of their rendered sound (consolidate, convert to audio).
 * `removeFrom` are the clips to take out; the new clip goes on `trackId`, or on a new audio
 * track inserted below `below` (with `name`), whose id is returned.
 */
export function placeRendered(
  asset: AssetMeta,
  start: number,
  removeFrom: Id[],
  target: { trackId: Id } | { below: Id; name: string; muteSource?: boolean },
  label: string,
): Id {
  const ids = new Set(removeFrom)
  const clip = createClip({ name: asset.name, assetId: asset.id, start, duration: asset.duration })
  const newTrack = 'below' in target ? createTrack(target.name) : null
  if (newTrack) newTrack.clips.push(clip)
  update(label, (p) => {
    p.assets[asset.id] = asset
    for (const t of p.tracks) t.clips = t.clips.filter((c) => !ids.has(c.id))
    if (newTrack && 'below' in target) {
      const index = p.tracks.findIndex((t) => t.id === target.below)
      p.tracks.splice(index + 1, 0, newTrack)
      const source = p.tracks[index]
      if (target.muteSource && source) source.muted = true
    } else if ('trackId' in target) {
      findTrack(p, target.trackId)?.clips.push(clip)
    }
  })
  return newTrack?.id ?? ('trackId' in target ? target.trackId : '')
}

/**
 * Applies pitch-editor moves: the clip plays `edited` (the original with the moves rendered in)
 * and remembers the original and the moves. With no moves it goes back to the original.
 */
export function applyPitchEdits(clipId: Id, sourceAssetId: Id, edits: PitchEdit[], edited: AssetMeta | null) {
  update(edits.length ? 'Edit pitch' : 'Reset pitch edits', (p) => {
    const clip = findAudioClip(p, clipId)
    if (!clip) return
    if (edited && edits.length) {
      p.assets[edited.id] = edited
      clip.assetId = edited.id
      clip.pitchSource = { assetId: sourceAssetId, edits }
    } else {
      clip.assetId = sourceAssetId
      delete clip.pitchSource
    }
  })
}

export function renameClip(clipId: Id, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  update('Rename clip', (p) => {
    for (const t of p.tracks) {
      const clip = t.clips.find((c) => c.id === clipId)
      if (clip) clip.name = trimmed
    }
  })
}

/** Imported MIDI parts: each becomes a MIDI (or drum) track with one clip starting at `start`. */
export function addMidiTracks(
  parts: { name: string; notes: Note[]; kind?: 'midi' | 'drums' }[],
  start: number,
  label = 'Import MIDI',
): Id[] {
  const { project } = useProjectStore.getState()
  const spb = beatSeconds(project.bpm)
  const bar = secondsPerBar(project.bpm, project.timeSignature)
  const tracks = parts.map((part) => {
    const track = createTrack(part.name, part.kind ?? 'midi')
    const length = Math.max(bar, Math.ceil((notesEnd(part.notes) * spb) / bar - 1e-6) * bar)
    track.clips.push(createMidiClip({ name: part.name, start: Math.max(0, start), duration: length, notes: sortNotes(part.notes) }))
    return track
  })
  if (tracks.length) update(label, (p) => void p.tracks.push(...tracks))
  return tracks.map((t) => t.id)
}

// --- Drums ---------------------------------------------------------------------------------

function findPad(p: Project, trackId: Id, note: number): DrumPad | undefined {
  return findTrack(p, trackId)?.kit?.pads.find((pad) => pad.note === note)
}

/** Changes a pad's tune, decay or gain; a slider drag is one undo step (end it with endGesture). */
export function setPad(trackId: Id, note: number, changes: Partial<Pick<DrumPad, 'tune' | 'decay' | 'gain' | 'name' | 'choke'>>) {
  const key = Object.keys(changes).join(',')
  update(
    'Change pad',
    (p) => {
      const pad = findPad(p, trackId, note)
      if (!pad) return
      if (changes.tune !== undefined) pad.tune = clamp(changes.tune, -12, 12)
      if (changes.decay !== undefined) pad.decay = clamp(changes.decay, 0.25, 4)
      if (changes.gain !== undefined) pad.gain = clamp(changes.gain, 0, 2)
      if (changes.choke !== undefined) pad.choke = Math.round(clamp(changes.choke, 0, 4))
      if (changes.name?.trim()) pad.name = changes.name.trim()
      const kit = findTrack(p, trackId)!.kit!
      kit.preset = 'custom'
    },
    `pad:${trackId}:${note}:${key}`,
  )
}

/** Puts a one-shot on a pad (or, with null, goes back to the pad's synthesized sound). */
export function setPadSample(trackId: Id, note: number, asset: AssetMeta | null) {
  update(asset ? 'Set pad sample' : 'Clear pad sample', (p) => {
    const pad = findPad(p, trackId, note)
    if (!pad) return
    if (asset) {
      p.assets[asset.id] = asset
      pad.sample = { assetId: asset.id }
    } else {
      delete pad.sample
    }
    findTrack(p, trackId)!.kit!.preset = 'custom'
  })
}

/** Gives several pads new samples at once, as one undo step (the kit becomes custom). */
export function setPadSamples(trackId: Id, samples: { note: number; asset: AssetMeta }[], label = 'Kit from library') {
  if (!samples.length) return
  update(label, (p) => {
    for (const { note, asset } of samples) {
      const pad = findPad(p, trackId, note)
      if (!pad) continue
      p.assets[asset.id] = asset
      pad.sample = { assetId: asset.id }
    }
    const kit = findTrack(p, trackId)?.kit
    if (kit) kit.preset = 'custom'
  })
}

/** Replaces a drum track's kit with a preset (pad samples are dropped; undo brings them back). */
export function applyKitPreset(trackId: Id, presetId: string) {
  const kit = createKit(presetId)
  update('Change kit', (p) => {
    const t = findTrack(p, trackId)
    if (t?.kit) t.kit = kit
  })
}

export interface GeneratedPart {
  /** Name of the MIDI track the part goes on; it is created if there's none. */
  track: string
  instrument: SynthPreset
  /** Notes in beats from the drum clip's start. */
  notes: Note[]
}

/**
 * Writes a generated pattern as one undo step: `drums` replaces the drum clip's notes (in its
 * content beats), and each part replaces what its MIDI track has under the drum clip.
 */
export function applyPattern(drumClipId: Id, drums: Note[] | null, parts: GeneratedPart[], label = 'Generate pattern') {
  update(label, (p) => {
    const found = findMidiClip(p, drumClipId)
    if (!found) return
    const { clip } = found
    if (drums) clip.notes = sortNotes(drums)
    const end = clip.start + clip.duration
    // New tracks go right below the drum track, in the order given.
    let insertAt = p.tracks.indexOf(found.track) + 1
    for (const part of parts) {
      let track = p.tracks.find((t) => t.kind === 'midi' && t.name === part.track)
      if (!track) {
        track = createTrack(part.track, 'midi')
        track.instrument!.type = part.instrument
        p.tracks.splice(insertAt++, 0, track)
      }
      track.clips = track.clips.filter((c) => c.start >= end - 1e-6 || c.start + c.duration <= clip.start + 1e-6)
      track.clips.push(createMidiClip({ name: part.track, start: clip.start, duration: clip.duration, notes: sortNotes(part.notes) }))
    }
  })
}

// --- Lyrics --------------------------------------------------------------------------------

/** Adds a section (at the end by default) and returns its id. */
export function addLyricSection(kind: LyricSectionKind, index?: number): Id {
  const id = createId('lyr')
  update('Add lyrics section', (p) => void p.lyrics.splice(index ?? p.lyrics.length, 0, { id, kind, text: '' }))
  return id
}

/** Typing in a section is one undo step until the field loses focus (call endGesture). */
export function setLyricText(sectionId: Id, text: string) {
  update(
    'Edit lyrics',
    (p) => {
      const s = p.lyrics.find((x) => x.id === sectionId)
      if (s) s.text = text
    },
    `lyrics:${sectionId}`,
  )
}

export function setLyricKind(sectionId: Id, kind: LyricSectionKind) {
  update('Change section', (p) => {
    const s = p.lyrics.find((x) => x.id === sectionId)
    if (s) s.kind = kind
  })
}

export function moveLyricSection(sectionId: Id, toIndex: number) {
  update('Move section', (p) => {
    const from = p.lyrics.findIndex((x) => x.id === sectionId)
    if (from < 0) return
    const [s] = p.lyrics.splice(from, 1)
    p.lyrics.splice(clamp(toIndex, 0, p.lyrics.length), 0, s)
  })
}

export function removeLyricSection(sectionId: Id) {
  update('Delete section', (p) => {
    p.lyrics = p.lyrics.filter((x) => x.id !== sectionId)
  })
}

// --- Effects -------------------------------------------------------------------------------

/** A channel with an effect chain: a track or bus id, or the master. */
export type ChannelRef = Id | 'master'

function chainHolder(p: Project, ref: ChannelRef): { effects: Effect[]; fxBypass: boolean } | undefined {
  return ref === 'master' ? p.master : findChannel(p, ref)
}

/** Adds an effect at `index` (default: the end of the chain). Returns its id. */
export function addEffect(ref: ChannelRef, type: EffectType, index?: number): Id {
  const effect = createEffect(type)
  update(`Add ${EFFECTS[type].name}`, (p) => {
    const holder = chainHolder(p, ref)
    holder?.effects.splice(index ?? holder.effects.length, 0, effect)
  })
  return effect.id
}

export function removeEffect(ref: ChannelRef, effectId: Id) {
  update('Remove effect', (p) => {
    const holder = chainHolder(p, ref)
    if (holder) holder.effects = holder.effects.filter((e) => e.id !== effectId)
    const lanes = automationHolder(p, ref)
    if (lanes) pruneLanes(lanes)
  })
}

export function moveEffect(ref: ChannelRef, effectId: Id, toIndex: number) {
  update('Reorder effects', (p) => {
    const holder = chainHolder(p, ref)
    if (!holder) return
    const from = holder.effects.findIndex((e) => e.id === effectId)
    if (from < 0) return
    const [effect] = holder.effects.splice(from, 1)
    holder.effects.splice(clamp(toIndex, 0, holder.effects.length), 0, effect)
  })
}

export function toggleEffect(ref: ChannelRef, effectId: Id) {
  update('Toggle effect', (p) => {
    const effect = chainHolder(p, ref)?.effects.find((e) => e.id === effectId)
    if (effect) effect.enabled = !effect.enabled
  })
}

export function toggleChainBypass(ref: ChannelRef) {
  update('Toggle effects bypass', (p) => {
    const holder = chainHolder(p, ref)
    if (holder) holder.fxBypass = !holder.fxBypass
  })
}

/** Sets one parameter; a knob drag is one undo step (call endGesture when it ends). */
export function setEffectParam(ref: ChannelRef, effectId: Id, key: string, value: number | string | boolean) {
  const apply = (p: Project) => {
    const effect = chainHolder(p, ref)?.effects.find((e) => e.id === effectId)
    const def = effect && findParam(effect.type, key)
    if (effect && def) effect.params[key] = normalizeParam(def, value)
  }
  if (typeof value === 'number' && writeAutomation(ref, effectTarget(effectId, key), value, apply)) return
  update('Change effect', apply, `fx:${effectId}:${key}`)
}

export interface ChainTemplate {
  type: EffectType
  enabled?: boolean
  params?: EffectParams
}

/** Replaces a channel's chain with copies of the given effects (e.g. from a preset). */
export function applyChain(ref: ChannelRef, chain: ChainTemplate[], label: string) {
  const effects = chain.map((c) => ({ ...createEffect(c.type, c.params ?? {}), enabled: c.enabled ?? true }))
  update(label, (p) => {
    const holder = chainHolder(p, ref)
    if (holder) holder.effects = effects
    const lanes = automationHolder(p, ref)
    if (lanes) pruneLanes(lanes)
  })
}

// --- Automation ----------------------------------------------------------------------------

function laneOf(p: Project, channel: ChannelRef, target: AutomationTarget): AutomationLane | undefined {
  return automationHolder(p, channel)?.automation.find((l) => l.target === target)
}

/** A track, bus or the master: whatever holds the lanes. */
function automationHolder(p: Project, ref: ChannelRef): AutomatedChannel | undefined {
  return ref === 'master' ? p.master : findChannel(p, ref)
}

/** Drops lanes whose target no longer exists (e.g. after removing an effect). */
function pruneLanes(holder: AutomatedChannel) {
  holder.automation = holder.automation.filter((l) => resolveTarget(holder, l.target) !== null)
}

/** Creates an empty lane for a target if the channel doesn't have one yet. */
export function addAutomationLane(channel: ChannelRef, target: AutomationTarget) {
  update('Add automation', (p) => {
    const t = automationHolder(p, channel)
    if (!t || t.automation.some((l) => l.target === target) || !resolveTarget(t, target)) return
    t.automation.push({ target, points: [] })
  })
}

export function removeAutomationLane(channel: ChannelRef, target: AutomationTarget) {
  update('Remove automation', (p) => {
    const t = automationHolder(p, channel)
    if (t) t.automation = t.automation.filter((l) => l.target !== target)
  })
}

/** Adds a point (creating the lane if needed). Returns the point's index in the lane. */
export function addAutomationPoint(channel: ChannelRef, target: AutomationTarget, point: AutomationPoint): number {
  let index = -1
  update('Add automation point', (p) => {
    const t = automationHolder(p, channel)
    if (!t || !resolveTarget(t, target)) return
    let lane = t.automation.find((l) => l.target === target)
    if (!lane) {
      lane = { target, points: [] }
      t.automation.push(lane)
    }
    const clean = { time: Math.max(0, point.time), value: Math.min(1, Math.max(0, point.value)), curve: point.curve }
    lane.points = insertPoint(lane.points, clean)
    index = lane.points.findIndex((x) => x.time === clean.time)
  })
  return index
}

/**
 * Moves a point during a drag (one undo step per drag; call endGesture at the end). It can't
 * pass its neighbours, so its index stays the same.
 */
export function moveAutomationPoint(channel: ChannelRef, target: AutomationTarget, index: number, time: number, value: number) {
  update(
    'Move automation point',
    (p) => {
      const lane = laneOf(p, channel, target)
      const point = lane?.points[index]
      if (!lane || !point) return
      const min = index > 0 ? lane.points[index - 1].time + 0.001 : 0
      const max = index < lane.points.length - 1 ? lane.points[index + 1].time - 0.001 : Infinity
      point.time = Math.min(max, Math.max(min, time))
      point.value = Math.min(1, Math.max(0, value))
    },
    `auto-point:${channel}:${target}:${index}`,
  )
}

/** Sets the bend of the segment that starts at `index`. */
export function setAutomationCurve(channel: ChannelRef, target: AutomationTarget, index: number, curve: number) {
  update(
    'Bend automation',
    (p) => {
      const point = laneOf(p, channel, target)?.points[index]
      if (point) point.curve = Math.min(1, Math.max(-1, curve))
    },
    `auto-curve:${channel}:${target}:${index}`,
  )
}

export function deleteAutomationPoint(channel: ChannelRef, target: AutomationTarget, index: number) {
  update('Delete automation point', (p) => {
    const lane = laneOf(p, channel, target)
    if (lane) lane.points.splice(index, 1)
  })
}
