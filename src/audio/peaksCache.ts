import { useEffect, useSyncExternalStore } from 'react'
import type { Id } from '../model/types'
import { engine } from './engine'
import { PEAK_BLOCK, type Peaks } from './peaks'

const peaks = new Map<Id, Peaks>()
const pending = new Set<Id>()
const listeners = new Set<() => void>()
let worker: Worker | null = null

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./peaks.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: Id; min: Float32Array; max: Float32Array }>) => {
    const buffer = engine.assets.get(e.data.id)
    pending.delete(e.data.id)
    if (!buffer) return
    peaks.set(e.data.id, { blockDuration: PEAK_BLOCK / buffer.sampleRate, min: e.data.min, max: e.data.max })
    for (const l of listeners) l()
  }
  return worker
}

function request(assetId: Id) {
  if (peaks.has(assetId) || pending.has(assetId)) return
  const buffer = engine.assets.get(assetId)
  if (!buffer) return
  pending.add(assetId)
  // Copies, so the AudioBuffer's own data is never transferred away.
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice())
  getWorker().postMessage({ id: assetId, channels }, channels.map((c) => c.buffer))
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Waveform overview for an asset; computed in a worker on first use. */
export function usePeaks(assetId: Id): Peaks | undefined {
  const value = useSyncExternalStore(subscribe, () => peaks.get(assetId))
  useEffect(() => request(assetId), [assetId])
  return value
}
