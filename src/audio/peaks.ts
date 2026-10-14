// Waveform overviews: per-block min/max of an asset's audio, computed once per asset.

/** Samples per peak block (~172 blocks per second at 44.1 kHz). */
export const PEAK_BLOCK = 256

export interface Peaks {
  /** Seconds covered by one block. */
  blockDuration: number
  min: Float32Array
  max: Float32Array
}

/** Min/max per block across all channels. */
export function computePeaks(channels: Float32Array[], block = PEAK_BLOCK): { min: Float32Array; max: Float32Array } {
  const length = channels[0]?.length ?? 0
  const blocks = Math.ceil(length / block)
  const min = new Float32Array(blocks)
  const max = new Float32Array(blocks)
  for (let b = 0; b < blocks; b++) {
    let lo = 0
    let hi = 0
    const end = Math.min(length, (b + 1) * block)
    for (const data of channels) {
      for (let i = b * block; i < end; i++) {
        const v = data[i]
        if (v < lo) lo = v
        else if (v > hi) hi = v
      }
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max }
}

/** Min/max of the blocks covering [t0, t1) seconds. */
export function peakRange(peaks: Peaks, t0: number, t1: number): [number, number] {
  const from = Math.max(0, Math.floor(t0 / peaks.blockDuration))
  const to = Math.min(peaks.min.length, Math.max(from + 1, Math.ceil(t1 / peaks.blockDuration)))
  let lo = 0
  let hi = 0
  for (let i = from; i < to; i++) {
    if (peaks.min[i] < lo) lo = peaks.min[i]
    if (peaks.max[i] > hi) hi = peaks.max[i]
  }
  return [lo, hi]
}
