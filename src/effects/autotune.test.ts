import { describe, expect, it } from 'vitest'
import { AutoTuner, SCALES, SyncShifter, detectPitch, nearestScaleNote } from './specialist-dsp'

const sr = 44100
/** A voice-like tone: a fundamental with decaying harmonics. */
const voice = (freq: number, seconds: number, rate = sr) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => {
    let v = 0
    for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * freq * h * i) / rate) / h
    return 0.3 * v
  })
/** Pitch in Hz from upward zero crossings of the fundamental (after a low-pass smooth). */
const pitchOf = (x: Float32Array, from: number, to: number) => {
  // A crude low-pass (moving average) so harmonics don't add crossings.
  const smooth = new Float32Array(to - from)
  const width = 24
  for (let i = from; i < to; i++) {
    let s = 0
    for (let k = 0; k < width; k++) s += x[i - k] ?? 0
    smooth[i - from] = s / width
  }
  let n = 0
  for (let i = 1; i < smooth.length; i++) if (smooth[i - 1] < 0 && smooth[i] >= 0) n++
  return (n * sr) / smooth.length
}
const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440)
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

describe('detectPitch', () => {
  it('finds the fundamental of voice-like tones', () => {
    for (const f of [82.4, 110, 220, 330, 523.3]) {
      const block = voice(f, 0.045, sr / 2)
      expect(detectPitch(block, sr / 2)!).toBeCloseTo(f, 0)
    }
  })

  it('reports nothing for noise and silence', () => {
    let seed = 1
    const noise = Float32Array.from({ length: 1000 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1)
    expect(detectPitch(noise, sr / 2)).toBeNull()
    expect(detectPitch(new Float32Array(1000), sr / 2)).toBeNull()
  })
})

describe('nearestScaleNote', () => {
  it('snaps to the nearest note of the key and scale', () => {
    // C major: C# (61.2) snaps to C (60) or D (62), whichever is nearer.
    expect(nearestScaleNote(61.2, 0, SCALES.major)).toBe(62)
    expect(nearestScaleNote(60.8, 0, SCALES.major)).toBe(60)
    expect(nearestScaleNote(60.6, 0, SCALES.chromatic)).toBe(61)
    // A minor pentatonic: A C D E G; G# (68) goes to A (69) or G (67).
    expect([67, 69]).toContain(nearestScaleNote(68, 9, SCALES.minorPentatonic))
    expect(nearestScaleNote(70.4, 9, SCALES.minorPentatonic)).toBe(69)
  })
})

describe('SyncShifter', () => {
  it('shifts a pitched sound by a small ratio and keeps its level', () => {
    const shifter = new SyncShifter(sr)
    const input = voice(220, 2)
    const period = sr / 220
    const out = Float32Array.from(input, (x) => shifter.next(x, 2 ** (60 / 1200), period))
    expect(midiOf(pitchOf(out, sr / 2, 2 * sr)) - midiOf(220)).toBeCloseTo(0.6, 1)
    const rms = (x: Float32Array) => Math.sqrt(x.subarray(sr / 2).reduce((s, v) => s + v * v, 0) / (1.5 * sr))
    expect(rms(out) / rms(input)).toBeGreaterThan(0.9)
    expect(rms(out) / rms(input)).toBeLessThan(1.1)
  })

  it('passes the sound through unchanged (just delayed) when unpitched', () => {
    const shifter = new SyncShifter(sr)
    const input = voice(220, 0.5)
    const out = Float32Array.from(input, (x) => shifter.next(x, 1.05, null))
    const delay = Math.round(0.025 * sr)
    for (let i = delay + 100; i < delay + 200; i++) expect(out[i]).toBeCloseTo(input[i - delay], 5)
  })
})

describe('AutoTuner', () => {
  const run = (freq: number, opts: { key?: number; scale?: number[]; retune?: number; amount?: number } = {}) => {
    const tuner = new AutoTuner(sr)
    const { key = 0, scale = SCALES.chromatic, retune = 0, amount = 1 } = opts
    return Float32Array.from(voice(freq, 2), (x) => tuner.next(x, key, scale, retune, amount))
  }

  it('pulls a flat note up to the nearest note in the scale', () => {
    // A note 30 cents flat of A3 (220 Hz) comes out on A3.
    const out = run(hz(57 - 0.3))
    expect(midiOf(pitchOf(out, sr, 2 * sr))).toBeCloseTo(57, 1)
  })

  it('respects the scale and the amount', () => {
    // A#3 (58) in A minor pentatonic is pulled to A3 (57).
    expect(midiOf(pitchOf(run(hz(58), { key: 9, scale: SCALES.minorPentatonic }), sr, 2 * sr))).toBeCloseTo(57, 1)
    // Half the amount: only half the correction.
    expect(midiOf(pitchOf(run(hz(57 - 0.4), { amount: 0.5 }), sr, 2 * sr))).toBeCloseTo(56.8, 1)
  })

  it('reports what it hears', () => {
    const tuner = new AutoTuner(sr)
    voice(hz(57.2), 0.3).forEach((x) => tuner.next(x, 0, SCALES.chromatic, 0.05, 1))
    expect(tuner.heard!.target).toBe(57)
    expect(tuner.heard!.midi).toBeCloseTo(57.2, 1)
  })
})

describe('AutoTuner on a glide', () => {
  it('turns a slow slide into steps on the notes (hard tuning)', () => {
    // A voice sliding from 55 to 59 over 3 s, tuned hard and chromatically.
    const seconds = 3
    let phase = 0
    const input = Float32Array.from({ length: seconds * sr }, (_, i) => {
      const midi = 55 + (4 * i) / (seconds * sr)
      phase += hz(midi) / sr
      let v = 0
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * phase * h) / h
      return 0.3 * v
    })
    const tuner = new AutoTuner(sr)
    const out = Float32Array.from(input, (x) => tuner.next(x, 0, SCALES.chromatic, 0, 1))
    // Measured every 100 ms with the detector itself (crossing counts are too coarse for short
    // windows): most land within 20 cents of a whole note, which the slide alone never does.
    const deviation = (signal: Float32Array) =>
      Array.from({ length: 25 }, (_, k) => {
        const from = Math.round((0.4 + k * 0.1) * sr)
        const m = midiOf(detectPitch(signal.subarray(from, from + 2048), sr)!)
        return Math.abs(m - Math.round(m))
      })
    expect(deviation(out).filter((d) => d < 0.2).length).toBeGreaterThanOrEqual(20)
    expect(deviation(input).filter((d) => d < 0.2).length).toBeLessThan(12)
  })
})
