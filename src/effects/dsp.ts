// Pure signal helpers for effects. No Web Audio calls, so they are unit-tested.

/** Deterministic pseudo-random numbers (mulberry32), so a seed always gives the same noise. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seed derived from a string id, so each reverb has its own but stable impulse response. */
export function seedFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A reverb impulse response: decorrelated noise per channel with an exponential decay that is
 * 60 dB down after `decay` seconds, and a short fade-in so the onset doesn't click.
 */
export function reverbImpulse(sampleRate: number, decay: number, seed: number, channels = 2): Float32Array[] {
  const length = Math.max(1, Math.round(sampleRate * decay))
  const random = seededRandom(seed)
  const fadeIn = Math.round(sampleRate * 0.004)
  // ln(1000) ≈ 6.9: amplitude falls to 1/1000 (-60 dB) at the end.
  const rate = 6.9 / length
  return Array.from({ length: channels }, () => {
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const env = Math.exp(-rate * i) * (i < fadeIn ? i / fadeIn : 1)
      data[i] = (random() * 2 - 1) * env
    }
    return data
  })
}

/** Soft-clipping curve for a WaveShaper: tanh with `drive` in dB, normalised so ±1 maps to ±1. */
export function saturationCurve(driveDb: number, size = 4096): Float32Array {
  const k = 10 ** (driveDb / 20)
  const norm = Math.tanh(k)
  const curve = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

/** Equal-power dry/wet gains for a mix amount 0–1 (no level dip in the middle). */
export function mixGains(mix: number): { dry: number; wet: number } {
  const m = Math.min(1, Math.max(0, mix))
  return { dry: Math.cos((m * Math.PI) / 2), wet: Math.sin((m * Math.PI) / 2) }
}

export const dbToGain = (db: number) => 10 ** (db / 20)
