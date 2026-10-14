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

/**
 * A plate reverb impulse: denser and brighter at the start than a room, darkening as it decays
 * (each channel's noise runs through a one-pole low-pass that closes over time).
 */
export function plateImpulse(sampleRate: number, decay: number, seed: number, channels = 2): Float32Array[] {
  const length = Math.max(1, Math.round(sampleRate * decay))
  const random = seededRandom(seed)
  const fadeIn = Math.round(sampleRate * 0.001)
  const rate = 6.9 / length
  return Array.from({ length: channels }, () => {
    const data = new Float32Array(length)
    let lp = 0
    for (let i = 0; i < length; i++) {
      // The filter coefficient falls from almost open (bright) to about 2 kHz at the end.
      const progress = i / length
      const a = 0.95 - 0.75 * progress
      lp += a * (random() * 2 - 1 - lp)
      const env = Math.exp(-rate * i) * (i < fadeIn ? i / fadeIn : 1)
      data[i] = lp * env * 1.6
    }
    return data
  })
}

/**
 * Soft-clipper curve over an input range of ±2 (the clipper halves the signal before it, so
 * peaks up to +6 dB are shaped). Below the knee the signal is untouched; above, it bends
 * smoothly into ±1. `softness` 0 is a hard clip, 1 starts bending at half scale.
 */
export function softClipCurve(softness: number, size = 4096): Float32Array {
  const knee = Math.min(1, Math.max(0, softness)) * 0.5
  const start = 1 - knee
  const curve = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const v = ((i / (size - 1)) * 2 - 1) * 2
    const a = Math.abs(v)
    let y: number
    if (a <= start) y = a
    else if (knee === 0) y = 1
    else y = start + knee * Math.tanh((a - start) / knee)
    curve[i] = Math.sign(v) * Math.min(1, y)
  }
  return curve
}

/** Seconds the duck takes to drop to its floor at each pulse. */
export const DUCK_ATTACK = 0.006

/**
 * Gain of the sidechain duck `phase` seconds after a pulse: it drops to 1 − depth, then recovers
 * toward 1 with time constant `tau`.
 */
export function duckGain(phase: number, depth: number, tau: number): number {
  const floor = 1 - Math.min(1, Math.max(0, depth))
  if (phase < DUCK_ATTACK) return floor
  return 1 - (1 - floor) * Math.exp(-(phase - DUCK_ATTACK) / Math.max(1e-4, tau))
}

/** Pulse times (multiples of `interval` from timeline 0) in [from, to). */
export function duckPulses(from: number, to: number, interval: number): number[] {
  const out: number[] = []
  // "+ 0" turns a -0 (from rounding just below zero) into 0.
  for (let k = Math.ceil(from / interval - 1e-9); k * interval < to - 1e-9; k++) out.push(k * interval + 0)
  return out
}
