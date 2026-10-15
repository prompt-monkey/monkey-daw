// Decoding, previewing and placing library samples.

import { engine } from '../audio/engine'
import type { AssetMeta, Id } from '../model/types'
import { addAudioClip, addTrackWithClip, replaceClipAudio, setPadSample } from '../state/actions'
import { useViewStore } from '../state/viewStore'
import { toast } from '../ui/toast'
import { useShellStore } from '../ui/shell'
import { useProjectStore } from '../state/projectStore'
import { getDatabase } from '../storage/db'
import { getSampleAudio, setSampleDuration } from './repo'
import { rememberDuration, useLibraryStore } from './store'

/** Drag-and-drop data type carrying a sample id. */
export const SAMPLE_DRAG_TYPE = 'application/x-monkey-daw-sample'

const DECODE_CACHE_SIZE = 24
const decoded = new Map<Id, AudioBuffer>()

async function sampleBlob(id: Id): Promise<Blob> {
  const blob = await getSampleAudio(getDatabase(), id)
  if (!blob) throw new Error('This sample is no longer in the library.')
  return blob
}

/** Decoded audio for a sample, cached for the most recently used ones. */
export async function decodeSample(id: Id): Promise<AudioBuffer> {
  const cached = decoded.get(id)
  if (cached) {
    decoded.delete(id)
    decoded.set(id, cached)
    return cached
  }
  const buffer = await engine.context.decodeAudioData(await (await sampleBlob(id)).arrayBuffer())
  decoded.set(id, buffer)
  if (decoded.size > DECODE_CACHE_SIZE) decoded.delete(decoded.keys().next().value!)
  void setSampleDuration(getDatabase(), id, buffer.duration)
  rememberDuration(id, buffer.duration)
  return buffer
}

/** Largest file measured in the background; bigger ones are measured when first previewed. */
const MEASURE_MAX_BYTES = 8 * 1024 * 1024

/**
 * Decodes samples whose duration is unknown (non-WAV files), one at a time, so the loop and
 * one-shot filters work without previewing each sample first.
 */
export async function measureUnknownDurations() {
  const pending = useLibraryStore.getState().samples.filter((s) => s.duration === null && s.size <= MEASURE_MAX_BYTES)
  for (const sample of pending) {
    try {
      const buffer = await engine.context.decodeAudioData(await (await sampleBlob(sample.id)).arrayBuffer())
      await setSampleDuration(getDatabase(), sample.id, buffer.duration)
      rememberDuration(sample.id, buffer.duration)
    } catch {
      // Undecodable files keep an unknown duration.
    }
  }
}

let current: { source: AudioBufferSourceNode; id: Id } | null = null

export function stopPreview() {
  if (!current) return
  try {
    current.source.stop()
  } catch {
    // Already stopped.
  }
  current = null
  useLibraryStore.setState({ previewingId: null })
}

/** Plays a sample on its own, straight to the speakers (not through the mix). */
export async function previewSample(id: Id) {
  stopPreview()
  const ctx = engine.context
  if (ctx.state !== 'running') await ctx.resume()
  const buffer = await decodeSample(id)
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  gain.gain.value = 0.9
  source.buffer = buffer
  source.connect(gain).connect(ctx.destination)
  source.onended = () => {
    if (current?.source === source) {
      current = null
      useLibraryStore.setState({ previewingId: null })
    }
  }
  source.start()
  current = { source, id }
  useLibraryStore.setState({ previewingId: id })
}

// One project asset per sample per session, so placing a sample twice reuses its audio.
const assetBySample = new Map<Id, AssetMeta>()

/** The project asset holding a sample's audio, imported on first use. */
export async function assetForSample(id: Id): Promise<AssetMeta> {
  const cached = assetBySample.get(id)
  if (cached && engine.assets.has(cached.id)) return cached
  const sample = useLibraryStore.getState().samples.find((s) => s.id === id)
  const blob = await sampleBlob(id)
  const extension = sample?.path.match(/\.[^.]+$/)?.[0] ?? ''
  const file = new File([blob], `${sample?.name ?? 'Sample'}${extension}`, { type: blob.type })
  const asset = await engine.assets.importFile(file, engine.context)
  assetBySample.set(id, asset)
  return asset
}

/**
 * Places a sample on the timeline. With an audio track's id it goes on that track; without one
 * it goes on the first audio track that is free at that time, or on a new track. A MIDI track
 * can't hold audio, so it gets a new track.
 */
export async function placeSample(id: Id, time: number, trackId?: Id | null) {
  const asset = await assetForSample(id)
  warnSignature(id)
  const tracks = useProjectStore.getState().project.tracks
  if (trackId && tracks.find((t) => t.id === trackId)?.kind !== 'audio') trackId = null
  if (trackId) {
    addAudioClip(trackId, asset, time)
    return
  }
  if (trackId === null) {
    addTrackWithClip(asset, time)
    return
  }
  const end = time + asset.duration
  const free = tracks.find((t) => t.kind === 'audio' && t.clips.every((c) => c.start >= end || c.start + c.duration <= time))
  if (free) addAudioClip(free.id, asset, time)
  else addTrackWithClip(asset, time)
}

/** The sample's time signature when its name gives one that differs from the project's. */
export function signatureMismatch(id: Id): string | null {
  const sample = useLibraryStore.getState().samples.find((s) => s.id === id)
  const { beats, unit } = useProjectStore.getState().project.timeSignature
  return sample?.signature && sample.signature !== `${beats}/${unit}` ? sample.signature : null
}

/** Warns when a dropped sample is in another time signature (6/8 into 4/4…). */
function warnSignature(id: Id) {
  const other = signatureMismatch(id)
  if (!other) return
  const { beats, unit } = useProjectStore.getState().project.timeSignature
  toast(`This sample is in ${other} and the project in ${beats}/${unit}: it may not line up with the bars.`)
}

/**
 * Uses a library sample for what the library was opened to pick: added at the end of a track,
 * swapped into a clip, or put on a drum pad. Closes the library on phones.
 */
export async function applyPickedSample(id: Id) {
  const view = useViewStore.getState()
  const pick = view.libraryPick
  if (!pick) return
  view.setLibraryPick(null)
  if (useShellStore.getState().narrow) view.setLibraryOpen(false)
  if (pick.kind === 'append') {
    const track = useProjectStore.getState().project.tracks.find((t) => t.id === pick.trackId)
    if (!track) return
    const end = track.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0)
    await placeSample(id, end, track.id)
  } else if (pick.kind === 'replace') {
    warnSignature(id)
    replaceClipAudio(pick.clipId, await assetForSample(id))
  } else {
    setPadSample(pick.trackId, pick.note, await assetForSample(id))
  }
}
