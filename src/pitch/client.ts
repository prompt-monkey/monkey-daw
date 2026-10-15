// Runs pitch analysis and pitch-edit renders in a worker. Analyses are kept per asset.

import { engine } from '../audio/engine'
import type { Id } from '../model/types'
import type { PitchNote, PitchSegment, PitchTrack } from './analysis'

export interface PitchAnalysis {
  track: PitchTrack
  notes: PitchNote[]
}

let worker: Worker | null = null
let nextJob = 0
const jobs = new Map<number, { resolve: (data: unknown) => void; reject: (err: Error) => void }>()
const analyses = new Map<Id, Promise<PitchAnalysis>>()

function call<T>(message: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ job: number; error?: string }>) => {
      const pending = jobs.get(e.data.job)
      jobs.delete(e.data.job)
      if (e.data.error) pending?.reject(new Error(e.data.error))
      else pending?.resolve(e.data)
    }
  }
  const job = nextJob++
  return new Promise<T>((resolve, reject) => {
    jobs.set(job, { resolve: resolve as (data: unknown) => void, reject })
    worker!.postMessage({ ...message, job }, transfer)
  })
}

function channelsOf(assetId: Id): { channels: Float32Array[]; sampleRate: number } {
  const buffer = engine.assets.get(assetId)
  if (!buffer) throw new Error('The audio for this clip is not loaded.')
  return {
    channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()),
    sampleRate: buffer.sampleRate,
  }
}

/** The pitch track and notes of an asset (analysed once, then kept). */
export function analyse(assetId: Id): Promise<PitchAnalysis> {
  let promise = analyses.get(assetId)
  if (!promise) {
    const { channels, sampleRate } = channelsOf(assetId)
    promise = call<PitchAnalysis>({ kind: 'analyse', channels, sampleRate }, channels.map((c) => c.buffer))
    promise.catch(() => analyses.delete(assetId))
    analyses.set(assetId, promise)
  }
  return promise
}

/** The asset's audio with the moves rendered in. */
export async function renderEdits(assetId: Id, track: PitchTrack, edits: PitchSegment[]): Promise<AudioBuffer> {
  const { channels, sampleRate } = channelsOf(assetId)
  const { channels: out } = await call<{ channels: Float32Array[] }>(
    { kind: 'render', channels, sampleRate, track, edits },
    channels.map((c) => c.buffer),
  )
  const buffer = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate })
  out.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  return buffer
}
