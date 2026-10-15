// Consolidate and convert to audio: render clips offline (the same graph as playback and export)
// and put the result back as one audio clip.

import { engine } from '../audio/engine'
import { renderProject } from '../audio/render'
import { isMidiClip, type Id, type Project, type Track } from '../model/types'
import { placeRendered } from '../state/actions'
import { useProjectStore } from '../state/projectStore'

/** Extra seconds rendered after note clips, so releases and effect tails aren't cut. */
const TAIL = 3
/** Below this level the rendered tail counts as silence and is trimmed off. */
const SILENCE = 10 ** (-80 / 20)

/**
 * The project with only some clips of one track heard. With `withEffects` the track keeps its
 * effect chain; either way its fader, pan, automation, sends and buses are left out (the new clip
 * goes back through the track), and the master is plain.
 */
export function isolate(project: Project, trackId: Id, clipIds: Id[], withEffects: boolean): Project {
  const ids = new Set(clipIds)
  const source = project.tracks.find((t) => t.id === trackId)
  if (!source) throw new Error('That track no longer exists.')
  const track: Track = {
    ...source,
    clips: source.clips.filter((c) => ids.has(c.id)),
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
    output: 'master',
    sends: [],
    automation: [],
    effects: withEffects ? source.effects : [],
  }
  return {
    ...project,
    tracks: [track],
    buses: [],
    master: { ...project.master, volume: 1, muted: false, effects: [], automation: [] },
  }
}

/** Index of the last sample above the silence level, plus a little, in frames. */
export function soundEnd(channels: Float32Array[]): number {
  let last = 0
  for (const c of channels) {
    for (let i = c.length - 1; i > last; i--) {
      if (Math.abs(c[i]) > SILENCE) {
        last = i
        break
      }
    }
  }
  return last + 1
}

async function renderClips(trackId: Id, clipIds: Id[], withEffects: boolean, tail: number) {
  const project = useProjectStore.getState().project
  const track = project.tracks.find((t) => t.id === trackId)
  const clips = track?.clips.filter((c) => clipIds.includes(c.id)) ?? []
  if (!track || !clips.length) throw new Error('There is nothing to render.')
  const start = Math.min(...clips.map((c) => c.start))
  const end = Math.max(...clips.map((c) => c.start + c.duration)) + tail
  const rendered = await renderProject(isolate(project, trackId, clipIds, withEffects), engine.assets, { start, end })
  // Trim the silent part of the tail.
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i))
  const length = tail > 0 ? Math.max(1, Math.min(rendered.length, soundEnd(channels) + Math.round(0.05 * rendered.sampleRate))) : rendered.length
  const trimmed = new AudioBuffer({ length, numberOfChannels: rendered.numberOfChannels, sampleRate: rendered.sampleRate })
  channels.forEach((c, i) => trimmed.copyToChannel(c.subarray(0, length), i))
  return { buffer: trimmed, start, track }
}

/**
 * Consolidates audio clips: on each track, the selected clips become one clip of their sound
 * (with gain, fades, pitch, reverse and tempo baked in, but not the track's effects).
 */
export async function consolidate(clipIds: Id[]): Promise<Id[]> {
  const project = useProjectStore.getState().project
  const created: Id[] = []
  for (const track of project.tracks) {
    const own = track.clips.filter((c) => clipIds.includes(c.id) && !isMidiClip(c)).map((c) => c.id)
    if (!own.length) continue
    const { buffer, start } = await renderClips(track.id, own, false, 0)
    const asset = engine.assets.add(`${track.name} (consolidated)`, buffer)
    placeRendered(asset, start, own, { trackId: track.id }, own.length > 1 ? 'Consolidate clips' : 'Bounce clip')
    created.push(asset.id)
  }
  return created
}

/**
 * Converts MIDI or drum clips to audio: their sound (with the track's effects if asked) goes on
 * a new audio track below, and the source track is muted so nothing plays twice.
 */
export async function convertToAudio(trackId: Id, clipIds: Id[], withEffects: boolean): Promise<Id> {
  const { buffer, start, track } = await renderClips(trackId, clipIds, withEffects, TAIL)
  const name = `${track.name} (audio)`
  const asset = engine.assets.add(name, buffer)
  return placeRendered(asset, start, [], { below: trackId, name, muteSource: true }, withEffects ? 'Convert to audio with effects' : 'Convert to audio')
}
