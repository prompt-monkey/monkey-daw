// Time-stretched copies of assets for synced clips in Stretch mode, made in a worker and cached
// per asset and rate. Until a copy is ready, playback falls back to resampling (the pitch follows
// the tempo for a moment) rather than going silent.

import type { Id, Project } from '../model/types'
import { clipRate } from '../model/tempo'
import { isMidiClip } from '../model/types'
import type { AssetRegistry } from './assets'

/** Most stretched copies kept; the least recently used go first. */
const CACHE_SIZE = 24

const cache = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer | null>>()
const listeners = new Set<() => void>()

const keyOf = (assetId: Id, rate: number) => `${assetId}@${rate.toFixed(5)}`

/** The stretched copy of an asset for a rate, if it's ready. */
export function stretchedBuffer(assetId: Id, rate: number): AudioBuffer | undefined {
  const key = keyOf(assetId, rate)
  const buffer = cache.get(key)
  if (buffer) {
    cache.delete(key)
    cache.set(key, buffer)
  }
  return buffer
}

/** Called whenever a new stretched copy is ready. */
export function onStretchReady(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let worker: Worker | null = null
let nextJob = 0
const jobs = new Map<number, (channels: Float32Array[] | null) => void>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./stretch.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ job: number; channels: Float32Array[] | null }>) => {
    jobs.get(e.data.job)?.(e.data.channels)
    jobs.delete(e.data.job)
  }
  return worker
}

/** Makes (or returns) the stretched copy of an asset for a rate. */
export function requestStretch(assets: AssetRegistry, assetId: Id, rate: number): Promise<AudioBuffer | null> {
  const key = keyOf(assetId, rate)
  const ready = cache.get(key)
  if (ready) return Promise.resolve(ready)
  const running = pending.get(key)
  if (running) return running
  const source = assets.get(assetId)
  if (!source) return Promise.resolve(null)
  const channels = Array.from({ length: source.numberOfChannels }, (_, i) => source.getChannelData(i).slice())
  const job = nextJob++
  const promise = new Promise<AudioBuffer | null>((resolve) => {
    jobs.set(job, (out) => {
      pending.delete(key)
      if (!out?.length) return resolve(null)
      const buffer = new AudioBuffer({ length: out[0].length, numberOfChannels: out.length, sampleRate: source.sampleRate })
      out.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i))
      cache.set(key, buffer)
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      resolve(buffer)
      for (const l of listeners) l()
    })
    getWorker().postMessage({ job, channels, sampleRate: source.sampleRate, rate }, channels.map((c) => c.buffer))
  })
  pending.set(key, promise)
  return promise
}

/** The (asset, rate) pairs a project needs stretched: its synced clips, in Stretch mode. */
export function neededStretches(project: Project): { assetId: Id; rate: number }[] {
  if (project.syncMode !== 'stretch') return []
  const seen = new Map<string, { assetId: Id; rate: number }>()
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (isMidiClip(c)) continue
      const rate = clipRate(c, project.bpm)
      if (Math.abs(rate - 1) > 1e-4) seen.set(keyOf(c.assetId, rate), { assetId: c.assetId, rate })
    }
  }
  return [...seen.values()]
}

/** Starts stretching everything the project needs; resolves when all of it is ready. */
export async function prepareStretches(project: Project, assets: AssetRegistry): Promise<void> {
  await Promise.all(neededStretches(project).map((s) => requestStretch(assets, s.assetId, s.rate)))
}

/**
 * The buffer to play a clip from, and whether it is already stretched. In Resample mode (or
 * while the stretched copy isn't ready) it is the original audio, played at the clip's rate.
 */
export function clipBuffer(
  project: Project,
  assets: AssetRegistry,
  assetId: Id,
  rate: number,
): { buffer: AudioBuffer; stretched: boolean } | null {
  const buffer = assets.get(assetId)
  if (!buffer) return null
  if (project.syncMode !== 'stretch' || Math.abs(rate - 1) <= 1e-4) return { buffer, stretched: false }
  const stretched = stretchedBuffer(assetId, rate)
  return stretched ? { buffer: stretched, stretched: true } : { buffer, stretched: false }
}
