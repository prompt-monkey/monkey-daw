// The small picture on each effect card: what the effect does with its current settings, drawn as
// one curve. Filters and EQs show their frequency response, dynamics their in/out curve, echoes
// and reverbs their repeats or tail, modulation its movement.

import type { Effect, EffectParams } from '../model/types'
import { autoMakeupDb, delaySeconds, duckInterval, duckShape } from './definitions'
import { duckGain, saturationCurve, tubeCurve } from './dsp'

export type VizKind = 'response' | 'transfer' | 'time' | 'motion'

export interface Viz {
  kind: VizKind
  /** Points with x and y in 0–1 (y = 1 at the top). */
  points: [number, number][]
  /** Draw as separate bars (echo taps) instead of a line. */
  bars?: boolean
  /** A y (0–1) for a reference line: 0 dB for responses, unity for transfers. */
  baseline?: number
}

const N = 64
const SR = 48000
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const p = (params: EffectParams, key: string) => params[key] as number

interface Band {
  type: BiquadFilterType
  freq: number
  q?: number
  gain?: number
}

/** Magnitude in dB of one Web Audio style biquad at `f` Hz (RBJ cookbook formulas). */
export function biquadDb(band: Band, f: number, sampleRate = SR): number {
  const w0 = (2 * Math.PI * Math.min(band.freq, sampleRate / 2 - 100)) / sampleRate
  const q = band.q ?? Math.SQRT1_2
  const A = 10 ** ((band.gain ?? 0) / 40)
  const cos = Math.cos(w0)
  const sin = Math.sin(w0)
  const alpha = sin / (2 * q)
  // Web Audio shelves use a fixed slope of 1.
  const shelfAlpha = (sin / 2) * Math.SQRT2
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  switch (band.type) {
    case 'lowpass':
      ;[b0, b1, b2, a0, a1, a2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha]
      break
    case 'highpass':
      ;[b0, b1, b2, a0, a1, a2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha]
      break
    case 'bandpass':
      ;[b0, b1, b2, a0, a1, a2] = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha]
      break
    case 'peaking':
      ;[b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A]
      break
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * shelfAlpha
      ;[b0, b1, b2] = [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s)]
      ;[a0, a1, a2] = [A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s]
      break
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * shelfAlpha
      ;[b0, b1, b2] = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)]
      ;[a0, a1, a2] = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s]
      break
    }
    default:
      return 0
  }
  const w = (2 * Math.PI * f) / sampleRate
  // |H(e^jw)|² from the numerator and denominator polynomials.
  const mag = (c0: number, c1: number, c2: number) => {
    const re = c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w)
    const im = -(c1 * Math.sin(w) + c2 * Math.sin(2 * w))
    return re * re + im * im
  }
  return 10 * Math.log10(Math.max(1e-12, mag(b0, b1, b2) / mag(a0, a1, a2)))
}

/** The filters an effect puts in the signal's path, for its response picture. */
function bands(effect: Effect): Band[] | null {
  const x = effect.params
  switch (effect.type) {
    case 'eq':
      return [
        { type: 'highpass', freq: p(x, 'lowCut') },
        { type: 'lowshelf', freq: p(x, 'lowFreq'), gain: p(x, 'lowGain') },
        { type: 'peaking', freq: p(x, 'midFreq'), q: p(x, 'midQ'), gain: p(x, 'midGain') },
        { type: 'highshelf', freq: p(x, 'highFreq'), gain: p(x, 'highGain') },
        ...(p(x, 'highCut') < 19999 ? [{ type: 'lowpass' as const, freq: p(x, 'highCut') }] : []),
      ]
    case 'filter':
      return [{ type: x.mode as BiquadFilterType, freq: p(x, 'cutoff'), q: p(x, 'resonance') }]
    case 'tilt':
      return [
        { type: 'lowshelf', freq: p(x, 'pivot'), gain: -p(x, 'tilt') + p(x, 'output') },
        { type: 'highshelf', freq: p(x, 'pivot'), gain: p(x, 'tilt') },
      ]
    case 'air':
      return [{ type: 'highshelf', freq: p(x, 'freq'), gain: p(x, 'amount') }]
    case 'subBoost':
      return [{ type: 'peaking', freq: p(x, 'freq'), q: 1.1, gain: (p(x, 'body') / 100) * 9 + (p(x, 'drive') / 100) * 3 }]
    case 'brass':
      return [
        { type: 'peaking', freq: 250, q: 0.8, gain: p(x, 'body') },
        { type: 'peaking', freq: 2500, q: 1.2, gain: p(x, 'bite') },
      ]
    case 'deesser':
      // The most it can take off the highs, once an "s" crosses the threshold.
      return [{ type: 'highshelf', freq: p(x, 'freq'), gain: -p(x, 'range') }]
    case 'vinyl': {
      const wear = p(x, 'wear') / 100
      return [
        { type: 'highpass', freq: 40 + 260 * wear },
        { type: 'lowpass', freq: 16000 * (2500 / 16000) ** wear },
      ]
    }
    case 'amp':
      return [
        { type: 'lowshelf', freq: 120, gain: p(x, 'bass') },
        { type: 'peaking', freq: 700, q: 0.8, gain: p(x, 'mid') },
        { type: 'highshelf', freq: 3000, gain: p(x, 'treble') },
        ...(x.cabinet !== 'off' ? [{ type: 'lowpass' as const, freq: 5000 }] : []),
      ]
    default:
      return null
  }
}

/** Response over 20 Hz–20 kHz, ±18 dB. */
function response(list: Band[]): Viz {
  const points: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const f = 20 * 1000 ** (i / (N - 1))
    const db = list.reduce((sum, b) => sum + biquadDb(b, f), 0)
    points.push([i / (N - 1), clamp01(0.5 - db / 36)])
  }
  return { kind: 'response', points, baseline: 0.5 }
}

/** In/out level curve over −60…0 dB. */
function transferDb(out: (inDb: number) => number): Viz {
  const points: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const inDb = -60 + (60 * i) / (N - 1)
    points.push([i / (N - 1), clamp01(-out(inDb) / 60)])
  }
  return { kind: 'transfer', points }
}

/** Waveshaper curve over ±1. */
function shaper(curve: Float32Array | ((x: number) => number)): Viz {
  const at = typeof curve === 'function' ? curve : (x: number) => curve[Math.round(((clampSigned(x) + 1) / 2) * (curve.length - 1))]
  const points: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1
    points.push([i / (N - 1), clamp01(0.5 - at(x) / 2)])
  }
  return { kind: 'transfer', points, baseline: 0.5 }
}

const clampSigned = (v: number) => Math.min(1, Math.max(-1, v))

/** Echo taps over `window` seconds: one bar per repeat, each scaled by the feedback. */
function taps(first: number, every: number, feedback: number, window: number, level = 1): Viz {
  const points: [number, number][] = []
  let amp = level
  for (let t = first; t <= window && amp > 0.02; t += every) {
    points.push([t / window, 1 - amp])
    amp *= feedback
  }
  return { kind: 'time', points, bars: true }
}

/** An LFO-like movement, two cycles. */
function motion(f: (phase: number) => number): Viz {
  const points: [number, number][] = []
  for (let i = 0; i < N; i++) points.push([i / (N - 1), clamp01(0.5 - f((2 * i) / (N - 1)) / 2)])
  return { kind: 'motion', points, baseline: 0.5 }
}

const sinWave = (phase: number) => Math.sin(2 * Math.PI * phase)

export function effectViz(effect: Effect, bpm: number): Viz {
  const x = effect.params
  const list = bands(effect)
  if (list) return response(list)
  switch (effect.type) {
    case 'compressor': {
      const thr = p(x, 'threshold')
      const ratio = p(x, 'ratio')
      const makeup = p(x, 'makeup') + (x.autoMakeup === true ? autoMakeupDb(thr, ratio) : 0)
      return transferDb((i) => Math.min(0, (i > thr ? thr + (i - thr) / ratio : i) + makeup))
    }
    case 'opto': {
      const thr = -6 - 34 * (p(x, 'peakReduction') / 100)
      return transferDb((i) => Math.min(0, (i > thr ? thr + (i - thr) / 3 : i) + p(x, 'gain')))
    }
    case 'gate':
      return transferDb((i) => (i < p(x, 'threshold') ? Math.max(-60, i + p(x, 'range')) : i))
    case 'saturation': {
      const curve = x.character === 'tube' ? tubeCurve(p(x, 'drive'), 512) : saturationCurve(p(x, 'drive'), 512)
      return shaper(curve)
    }
    case 'clipper': {
      const ceiling = 10 ** (p(x, 'ceiling') / 20)
      const drive = 10 ** (p(x, 'drive') / 20)
      return shaper((v) => Math.min(ceiling, Math.max(-ceiling, Math.tanh(v * drive * 1.2))))
    }
    case 'bitcrusher': {
      const steps = 2 ** Math.max(1, Math.floor(p(x, 'bits')) - 1)
      return shaper((v) => Math.round(v * steps) / steps)
    }
    case 'transient': {
      // A drum hit's envelope with the attack and sustain applied.
      const attack = p(x, 'attack') / 100
      const sustain = p(x, 'sustain') / 100
      const points: [number, number][] = []
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1)
        const env = Math.exp(-t / (0.25 * 2 ** sustain)) * (t < 0.08 ? 1 + attack * 0.6 * (1 - t / 0.08) : 1)
        points.push([t, clamp01(1 - env / 1.6)])
      }
      return { kind: 'time', points }
    }
    case 'delay': {
      const time = delaySeconds(x, bpm)
      return taps(time, time, p(x, 'feedback') / 100, Math.max(1, time * 6))
    }
    case 'tapeEcho': {
      const time = Math.max(0.05, delaySeconds(x, bpm))
      return taps(time, time, p(x, 'feedback') / 100, Math.max(1, time * 6))
    }
    case 'slapback': {
      const time = p(x, 'time') / 1000
      return taps(time, time, p(x, 'feedback') / 100, 1)
    }
    case 'crystal': {
      const splice = p(x, 'splice') / 1000
      return taps(splice, splice, p(x, 'feedback') / 100, Math.max(1, splice * 8))
    }
    case 'reverb':
    case 'plate': {
      const decay = p(x, 'decay')
      const pre = p(x, 'preDelay') / 1000
      const window = Math.max(1, decay * 1.2 + pre)
      const points: [number, number][] = [[0, 1]]
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * window
        // −60 dB at the decay time, drawn on a dB scale.
        const db = t < pre ? -60 : (-60 * (t - pre)) / decay
        points.push([t / window, clamp01(-db / 60)])
      }
      return { kind: 'time', points }
    }
    case 'duck': {
      const interval = duckInterval(x, bpm)
      const { tau, hold } = duckShape(x, interval)
      const depth = p(x, 'depth') / 100
      return motion((phase) => duckGain((phase % 1) * interval, depth, tau, hold) * 2 - 1)
    }
    case 'tremolo': {
      const depth = p(x, 'depth') / 100
      const shape = x.shape === 'square' ? (ph: number) => (ph % 1 < 0.5 ? 1 : -1) : x.shape === 'triangle' ? (ph: number) => 1 - 4 * Math.abs((ph % 1) - 0.5) : sinWave
      return motion((ph) => shape(ph) * depth)
    }
    case 'chorus':
    case 'phaser':
    case 'vibrato':
      return motion((ph) => sinWave(ph) * (p(x, 'depth') / 100))
    case 'tape':
      return motion((ph) => (Math.sin(2 * Math.PI * ph) * 0.8 + Math.sin(2 * Math.PI * ph * 9) * (p(x, 'flutter') / 500)) * (p(x, 'wobble') / 100))
    case 'midside':
    case 'spread':
    case 'doubler': {
      // Stereo width: a wave on each side, further apart the wider the sound.
      const width = effect.type === 'midside' ? clamp01(0.5 + p(x, 'side') / 24) : p(x, effect.type === 'doubler' ? 'spread' : 'amount') / 100
      return motion((ph) => sinWave(ph) * (ph < 1 ? 0.3 + 0.6 * width : -(0.3 + 0.6 * width)))
    }
    case 'autotune': {
      // Notes pulled onto steps: a sliding pitch turned into a staircase, sharper at faster retune.
      const hard = 1 - p(x, 'retune') / 400
      return motion((ph) => {
        const slide = ph * 2 - 2
        const step = Math.round(slide * 3) / 3
        return (slide + (step - slide) * hard * (p(x, 'amount') / 100)) * 0.45
      })
    }
    default:
      return motion(() => 0)
  }
}

/** SVG path for a picture in a `w` × `h` box. */
export function vizPath(viz: Viz, w: number, h: number): string {
  if (viz.bars) return viz.points.map(([x, y]) => `M${(x * w).toFixed(1)},${h}V${(y * h).toFixed(1)}`).join('')
  return viz.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * w).toFixed(1)},${(y * h).toFixed(1)}`).join('')
}
