import { describe, expect, it } from 'vitest'
import { suggestedTail } from '../audio/export'
import { createProject } from '../model/factory'
import { heatCurve, subCurve, vinylSurface } from './creative'
import { Crystal, GrainShifter, TapeEcho } from './creative-dsp'
import { EFFECTS, EFFECT_TYPES, createEffect, formatValue, type NumberParam } from './definitions'

const sr = 8000
const sine = (freq: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr))
/** Upward zero crossings per second. */
const frequency = (x: Float32Array, a: number, b: number) => {
  let n = 0
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++
  return (n * sr) / (b - a)
}
const peak = (x: ArrayLike<number>, a = 0, b = x.length) => {
  let m = 0
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}

describe('batch 4 definitions', () => {
  it('lists the creative effects', () => {
    expect(EFFECT_TYPES.filter((t) => EFFECTS[t].group === 'creative')).toEqual(['crystal', 'tapeEcho', 'subBoost', 'brass', 'vinyl'])
  })

  it('shows semitones as whole steps', () => {
    const shift = EFFECTS.crystal.params[0] as NumberParam
    expect([formatValue(shift, 12), formatValue(shift, -4.6), formatValue(shift, 0)]).toEqual(['+12 st', '-5 st', '0 st'])
  })

  it('leaves room for the echoes and shimmer when exporting', () => {
    const p = createProject()
    p.master.effects = [createEffect('crystal', { splice: 500, feedback: 50 })]
    expect(suggestedTail(p)).toBeGreaterThanOrEqual(5)
    p.master.effects = [createEffect('tapeEcho', { time: 500, feedback: 50 })]
    expect(suggestedTail(p)).toBeGreaterThanOrEqual(5)
  })
})

describe('grain shifter', () => {
  it('shifts a tone up an octave with a variable grain', () => {
    const shifter = new GrainShifter(sr, 0.5)
    const input = sine(200, 1)
    const out = input.map((x) => shifter.next(x, 2, 0.1 * sr))
    expect(frequency(out, sr / 2, sr)).toBeGreaterThan(370)
    expect(frequency(out, sr / 2, sr)).toBeLessThan(430)
  })
})

describe('crystal', () => {
  it('rings on after the input stops, an octave up', () => {
    const crystal = new Crystal(sr)
    const input = new Float32Array(sr * 2)
    input.set(sine(200, 0.5))
    const out = input.map((x) => crystal.next(x, 12, 0.1, 0.6))
    // Half a second after the input ended there are still repeats.
    expect(peak(out, sr, sr + sr / 4)).toBeGreaterThan(0.02)
    expect(frequency(out, sr / 4, sr / 2)).toBeGreaterThan(350)
  })

  it('stays stable at full feedback', () => {
    const crystal = new Crystal(sr)
    const out = sine(300, 4, 0.9).map((x) => crystal.next(x, 12, 0.06, 0.85))
    expect(peak(out)).toBeLessThan(6)
    expect(out.every(Number.isFinite)).toBe(true)
  })
})

describe('tape echo', () => {
  it('echoes after the delay time and fades with feedback', () => {
    const echo = new TapeEcho(sr)
    const input = new Float32Array(sr * 2)
    input.fill(0.8, 0, 40)
    const out = input.map((x) => echo.next(x, 0.25, 0.5, 0, 0))
    // Nothing before the first echo, then repeats a quarter second apart, each quieter.
    expect(peak(out, 0, Math.round(0.24 * sr))).toBeLessThan(1e-6)
    const first = peak(out, Math.round(0.24 * sr), Math.round(0.3 * sr))
    const second = peak(out, Math.round(0.49 * sr), Math.round(0.55 * sr))
    expect(first).toBeGreaterThan(0.05)
    expect(second).toBeGreaterThan(0)
    expect(second).toBeLessThan(first)
  })

  it('raises the pitch of each repeat when shifted', () => {
    const echo = new TapeEcho(sr)
    const input = new Float32Array(sr * 2)
    input.set(sine(150, 0.2))
    const out = input.map((x) => echo.next(x, 0.3, 0.8, 0, 12))
    const firstPitch = frequency(out, Math.round(0.33 * sr), Math.round(0.47 * sr))
    const secondPitch = frequency(out, Math.round(0.63 * sr), Math.round(0.77 * sr))
    expect(secondPitch).toBeGreaterThan(firstPitch * 1.6)
  })
})

describe('node-built creative effects', () => {
  it('saturates quiet signals without changing their level', () => {
    const c = heatCurve()
    const at = (u: number) => c[Math.round(((u + 1) / 2) * (c.length - 1))]
    // u is input / 4: quiet signals go through at about unity gain, loud peaks bend toward 1.
    expect((at(0.02) - at(-0.02)) / (0.04 * 4)).toBeCloseTo(1, 1)
    expect(at(1)).toBeCloseTo(1, 2)
    expect(subCurve()[subCurve().length - 1]).toBeCloseTo(Math.tanh(3))
  })

  it('makes record noise with crackles, the same each time for an effect', () => {
    const a = vinylSurface(sr, 7)
    expect(a.length).toBe(3 * sr)
    expect(Array.from(a)).toEqual(Array.from(vinylSurface(sr, 7)))
    const loud = a.filter((x) => Math.abs(x) > 0.3).length
    expect(loud).toBeGreaterThan(5)
  })
})
