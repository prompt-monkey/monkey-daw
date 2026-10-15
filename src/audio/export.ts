// Export: render the project offline (the mix, or one stem per track), then encode WAV or MP3
// in a worker. Stems are bundled into a ZIP.

import { delaySeconds } from '../effects/definitions'
import { projectLength } from '../model/factory'
import { zip, type Zippable } from 'fflate'
import type { Effect, Project, Track } from '../model/types'
import { engine } from './engine'
import { renderProject, type RenderRange } from './render'
import { loopIsActive } from './schedule'
import type { EncodeRequest } from './encode.worker'
import type { Mp3Bitrate } from './mp3'
import { peakOf, type BitDepth } from './wav'
import { exportFilename, safeName } from './download'

export { downloadBlob, exportFilename } from './download'

export type ExportScope = 'project' | 'loop'
export type ExportFormat = 'wav' | 'mp3'
/** The mixed song, or one file per track. */
export type ExportContent = 'mix' | 'stems'

export interface ExportSettings {
  scope: ExportScope
  content: ExportContent
  format: ExportFormat
  sampleRate: 44100 | 48000
  /** WAV only. */
  bitDepth: BitDepth
  /** MP3 only, in kbps. */
  mp3Bitrate: Mp3Bitrate
  /** Extra seconds after the last clip so reverb and delay decays aren't cut off (project scope only). */
  tail: number
}

export interface ExportResult {
  blob: Blob
  filename: string
  /** Highest sample value in the mix (or the loudest stem); above 1 means the file clipped. */
  peak: number
  duration: number
  /** Number of audio files: 1 for a mix, one per stem. */
  files: number
}

/** The time range an export covers, or null when there is nothing to export. */
export function exportRange(project: Project, scope: ExportScope, tail = 0): RenderRange | null {
  if (scope === 'loop') return loopIsActive(project.loop) ? { start: project.loop.start, end: project.loop.end } : null
  const end = projectLength(project)
  return end > 0 ? { start: 0, end: end + Math.max(0, tail) } : null
}

/** Longest tail a single time-based effect can add, in seconds. */
const MAX_TAIL = 10

function effectTail(effect: Effect, bpm: number): number {
  if (!effect.enabled) return 0
  if (effect.type === 'reverb' || effect.type === 'plate') {
    return (effect.params.decay as number) + (effect.params.preDelay as number) / 1000
  }
  if (effect.type === 'slapback') {
    const feedback = (effect.params.feedback as number) / 100
    const repeats = feedback > 0.01 ? Math.ceil(Math.log(0.001) / Math.log(feedback)) : 1
    return ((effect.params.time as number) / 1000) * repeats
  }
  if (effect.type === 'delay') {
    // Echoes until they are 60 dB down: each repeat is multiplied by the feedback.
    const feedback = Math.max(0.01, (effect.params.feedback as number) / 100)
    const repeats = Math.ceil(Math.log(0.001) / Math.log(feedback))
    return delaySeconds(effect.params, bpm) * Math.max(1, repeats)
  }
  if (effect.type === 'tapeEcho') {
    const feedback = Math.max(0.01, (effect.params.feedback as number) / 100)
    return Math.max(0.05, delaySeconds(effect.params, bpm)) * Math.max(1, Math.ceil(Math.log(0.001) / Math.log(feedback)))
  }
  if (effect.type === 'crystal') {
    // Each repeat is one splice later and quieter by the feedback.
    const feedback = Math.max(0.01, (effect.params.feedback as number) / 100)
    return ((effect.params.splice as number) / 1000) * Math.max(2, Math.ceil(Math.log(0.001) / Math.log(feedback)) + 1)
  }
  return 0
}

/** Seconds of tail the project's reverbs and delays need, rounded up to a whole second. */
export function suggestedTail(project: Project): number {
  const chains = [
    ...project.tracks.filter((t) => !t.fxBypass).map((t) => t.effects),
    ...project.buses.filter((b) => !b.fxBypass).map((b) => b.effects),
    project.master.fxBypass ? [] : project.master.effects,
  ]
  // Chains in series (track → bus → master) add up in the worst case; keep it simple and bounded.
  const longest = chains.flat().reduce((max, e) => Math.max(max, effectTail(e, project.bpm)), 0)
  return Math.min(MAX_TAIL, Math.ceil(longest))
}



/** Tracks that get a stem: every track that isn't muted and has clips (solo is ignored). */
export function stemTracks(project: Project): Track[] {
  return project.tracks.filter((t) => !t.muted && t.clips.length > 0)
}

/**
 * The project with only one track heard. It still goes through its buses and the master, so the
 * stems add up to the mix (apart from effects that react to the whole mix, like a master
 * compressor).
 */
export function stemProject(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, solo: false, muted: t.muted || t.id !== trackId })) }
}

/** "03 Lead vocal.mp3": numbered in track order, so the files sort like the tracks. */
export function stemFilename(index: number, trackName: string, extension: string): string {
  return `${String(index + 1).padStart(2, '0')} ${safeName(trackName, 'Track')}.${extension}`
}

function encodeInWorker(request: EncodeRequest): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Encoding failed'))
    }
    worker.postMessage(request, request.channels.map((c) => c.buffer))
  })
}

const zipAsync = (files: Zippable) =>
  new Promise<Uint8Array>((resolve, reject) => zip(files, (err, data) => (err ? reject(err) : resolve(data))))

const MIME: Record<ExportFormat, string> = { wav: 'audio/wav', mp3: 'audio/mpeg' }

/** Renders one version of the project and encodes it. Progress goes 0…1. */
async function renderAndEncode(
  project: Project,
  range: RenderRange,
  settings: ExportSettings,
  onProgress: (fraction: number) => void,
): Promise<{ data: ArrayBuffer; peak: number }> {
  const rendered = await renderProject(project, engine.assets, range, {
    sampleRate: settings.sampleRate,
    onProgress: (f) => onProgress(f * 0.85),
  })
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i).slice())
  const peak = peakOf(channels)
  const data = await encodeInWorker(
    settings.format === 'wav'
      ? { format: 'wav', channels, sampleRate: settings.sampleRate, bitDepth: settings.bitDepth }
      : { format: 'mp3', channels, sampleRate: settings.sampleRate, bitrate: settings.mp3Bitrate },
  )
  onProgress(1)
  return { data, peak }
}

/** Renders and encodes the mix, or every stem into a ZIP. Progress goes 0…1. */
export async function exportMix(
  project: Project,
  settings: ExportSettings,
  onProgress: (fraction: number) => void = () => {},
): Promise<ExportResult> {
  const range = exportRange(project, settings.scope, settings.tail)
  if (!range) throw new Error(settings.scope === 'loop' ? 'Turn on a loop region to export it.' : 'There are no clips to export.')
  const duration = range.end - range.start
  const ext = settings.format

  if (settings.content === 'mix') {
    const { data, peak } = await renderAndEncode(project, range, settings, onProgress)
    return { blob: new Blob([data], { type: MIME[ext] }), filename: exportFilename(project.name, settings.scope, ext), peak, duration, files: 1 }
  }

  const tracks = stemTracks(project)
  if (!tracks.length) throw new Error('There are no unmuted tracks with clips to export.')
  const files: Zippable = {}
  let peak = 0
  for (const [i, track] of tracks.entries()) {
    const stem = await renderAndEncode(stemProject(project, track.id), range, settings, (f) => onProgress((i + f) / tracks.length * 0.97))
    peak = Math.max(peak, stem.peak)
    files[stemFilename(project.tracks.indexOf(track), track.name, ext)] = [new Uint8Array(stem.data), { level: 0 }]
  }
  const zipped = await zipAsync(files)
  onProgress(1)
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    filename: exportFilename(project.name, settings.scope, 'zip', ' stems'),
    peak,
    duration,
    files: tracks.length,
  }
}
