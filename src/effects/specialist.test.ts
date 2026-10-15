import { describe, expect, it } from 'vitest'
import { EFFECTS, EFFECT_TYPES, createEffect, formatValue, type NumberParam } from './definitions'
import { ampCurve } from './specialist'
import { DeEsser, Doubler, OptoCompressor, PitchShifter, TransientShaper } from './specialist-dsp'

const sr = 8000
const sine = (freq: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr))
const rms = (x: ArrayLike<number>, a = 0, b = x.length) => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / (b - a))
}
/** Upward zero crossings per second. */
const frequency = (x: Float32Array, a: number, b: number) => {
  let n = 0
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++
  return (n * sr) / (b - a)
}
/** Energy within ±40 Hz of `center` (a Goertzel scan in 2 Hz steps). */
const bandPower = (x: Float32Array, a: number, b: number, center: number) => {
  let total = 0
  for (let f = center - 40; f <= center + 40; f += 2) {
    const w = (2 * Math.PI * f) / sr
    let re = 0
    let im = 0
    for (let i = a; i < b; i++) {
      re += x[i] * Math.cos(w * i)
      im -= x[i] * Math.sin(w * i)
    }
    total += re * re + im * im
  }
  return total
}
/** A decaying burst: sharp attack, ringing tail. */
const hit = (seconds = 0.5) => Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => Math.exp(-i / (0.08 * sr)) * Math.sin(i * 0.3))

describe('batch 3 definitions', () => {
  it('lists the specialist effects', () => {
    expect(EFFECT_TYPES.filter((t) => EFFECTS[t].group === 'specialist')).toEqual(['transient', 'deesser', 'opto', 'doubler', 'amp', 'autotune'])
    expect(createEffect('autotune').params).toMatchObject({ key: '0', scale: 'chromatic', retune: 40, amount: 100 })
    expect(createEffect('amp').params).toMatchObject({ cabinet: '1x12', drive: 18 })
    expect(formatValue(EFFECTS.doubler.params[1] as NumberParam, 7.6)).toBe('8 ct')
  })
})

describe('TransientShaper', () => {
  const shape = (attack: number, sustain: number) => {
    const t = new TransientShaper(sr)
    return Array.from(hit(), (x) => x * t.gain(Math.abs(x), attack, sustain))
  }

  it('leaves the sound alone at zero', () => {
    const plain = Array.from(hit())
    expect(shape(0, 0)).toEqual(plain.map((x) => x * 1))
  })

  it('boosts or softens the attack, and lengthens or shortens the tail', () => {
    const head = (x: number[]) => rms(x, 0, 80)
    const tail = (x: number[]) => rms(x, 1600, 3200)
    expect(head(shape(1, 0))).toBeGreaterThan(head(shape(0, 0)) * 1.3)
    expect(head(shape(-1, 0))).toBeLessThan(head(shape(0, 0)) * 0.8)
    expect(tail(shape(0, 1))).toBeGreaterThan(tail(shape(0, 0)) * 1.3)
    expect(tail(shape(0, -1))).toBeLessThan(tail(shape(0, 0)) * 0.8)
  })
})

describe('DeEsser', () => {
  // Real sample rate and frequencies: an "s" around 9 kHz, split at 5 kHz.
  const rate = 44100
  const tone = (freq: number, amp: number) =>
    Float32Array.from({ length: rate }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate))
  const run = (input: Float32Array) => {
    const d = new DeEsser(rate)
    return Float32Array.from(input, (x) => {
      const frame = [x]
      d.frame(frame, 5000, -30, 12)
      return frame[0]
    })
  }
  const body = [rate / 2, rate] as const

  it('turns down loud highs and leaves lows and quiet highs alone', () => {
    const ess = tone(9000, 0.5)
    expect(rms(run(ess), ...body)).toBeLessThan(rms(ess, ...body) * 0.5)
    const low = tone(300, 0.5)
    expect(rms(run(low), ...body)).toBeCloseTo(rms(low, ...body), 2)
    const quietEss = tone(9000, 0.005)
    expect(rms(run(quietEss), ...body)).toBeCloseTo(rms(quietEss, ...body), 3)
  })
})

describe('OptoCompressor', () => {
  it('compresses more with more peak reduction, and releases in two stages', () => {
    const settle = (amount: number) => {
      const c = new OptoCompressor(sr)
      let g = 1
      for (let i = 0; i < sr; i++) g = c.gain(0.8, amount)
      return g
    }
    expect(settle(0)).toBeGreaterThan(0.7)
    expect(settle(1)).toBeLessThan(settle(0.5))
    expect(settle(1)).toBeLessThan(0.3)

    const c = new OptoCompressor(sr)
    let during = 1
    for (let i = 0; i < sr; i++) during = c.gain(0.8, 1)
    const after = (seconds: number) => {
      let g = 0
      for (let i = 0; i < seconds * sr; i++) g = c.gain(0, 1)
      return g
    }
    const quick = after(0.3)
    const slow = after(2)
    // The fast half comes back within a fraction of a second; the slow half takes seconds.
    expect(quick).toBeGreaterThan(during * 2)
    expect(quick).toBeLessThan(0.5)
    expect(slow).toBeGreaterThan(0.6)
  })
})

describe('PitchShifter and Doubler', () => {
  const body = [sr / 2, sr * 2] as const

  it('moves the energy to the shifted pitch for large shifts, keeping the level', () => {
    // The two-head design splices 25 times a second on an octave, which smears the new pitch
    // into sidebands; most of the energy still lands around the target.
    for (const ratio of [2, 0.5]) {
      const p = new PitchShifter(sr)
      const out = Float32Array.from(sine(220, 2), (x) => p.next(x, ratio))
      expect(bandPower(out, ...body, 220 * ratio)).toBeGreaterThan(bandPower(out, ...body, 220) * 4)
      expect(rms(out, ...body)).toBeGreaterThan(0.25)
    }
  })

  it('detunes small amounts precisely', () => {
    const p = new PitchShifter(sr)
    const out = Float32Array.from(sine(220, 2), (x) => p.next(x, 1.03))
    expect(frequency(out, ...body) / 220).toBeCloseTo(1.03, 2)
  })

  it('puts the octave copy left and the detuned copy right', () => {
    const d = new Doubler(sr)
    const l: number[] = []
    const r: number[] = []
    sine(220, 4).forEach((x) => {
      const [a, b] = d.next(x, 1, 8, 1)
      l.push(a)
      r.push(b)
    })
    const left = Float32Array.from(l)
    expect(bandPower(left, sr / 2, sr, 440)).toBeGreaterThan(bandPower(left, sr / 2, sr, 220) * 4)
    // 8 cents up from 220 Hz is about 221 Hz (measured over 3 s for a fine enough count).
    expect(frequency(Float32Array.from(r), sr, sr * 4)).toBeCloseTo(221, 0)
  })
})

describe('ampCurve', () => {
  it('is asymmetric and stays within ±1', () => {
    const c = ampCurve(1025)
    expect(Math.max(...c.map(Math.abs))).toBeCloseTo(1)
    expect(c[512]).toBeCloseTo(0, 5)
    expect(Math.abs(c[1024])).not.toBeCloseTo(Math.abs(c[0]), 2)
  })
})
