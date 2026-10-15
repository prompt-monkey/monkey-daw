import { describe, expect, it } from 'vitest'
import { autoMakeupDb, duckInterval, duckShape, normalizeEffect, syncedValue } from './definitions'
import { duckGain, saturationCurve, tubeCurve } from './dsp'
import { OptoCompressor } from './specialist-dsp'

describe('added effect controls', () => {
  it('loads effects saved before the new controls with sound-preserving defaults', () => {
    const old = { id: 'fx1', type: 'compressor', enabled: true, params: { threshold: -20, ratio: 3, knee: 10 } }
    expect(normalizeEffect(old)!.params).toMatchObject({ mode: 'free', autoMakeup: false, knee: 10 })
    const reverb = normalizeEffect({ id: 'fx2', type: 'reverb', enabled: true, params: { preDelay: 30 } })!
    expect(reverb.params).toMatchObject({ sync: 'off', stereo: true, preDelay: 30 })
    const ms = normalizeEffect({ id: 'fx3', type: 'midside', enabled: true, params: {} })!
    expect(ms.params).toMatchObject({ monoBass: false, bassFreq: 120 })
    expect(normalizeEffect({ id: 'fx4', type: 'saturation', enabled: true, params: {} })!.params.character).toBe('tape')
  })

  it('syncs the reverb pre-delay to the tempo', () => {
    expect(syncedValue('reverb', { sync: '1/16' }, 120)).toBeCloseTo(0.125)
    expect(syncedValue('reverb', { sync: 'off' }, 120)).toBeNull()
  })

  it('makes up about half the most a compressor can take off', () => {
    expect(autoMakeupDb(-20, 4)).toBeCloseTo(7.5)
    expect(autoMakeupDb(-20, 1)).toBe(0)
  })

  it('bends tube saturation more on one side than the other', () => {
    const tube = tubeCurve(12)
    const tape = saturationCurve(12)
    const at = (c: Float32Array, x: number) => c[Math.round(((x + 1) / 2) * (c.length - 1))]
    expect(at(tape, 0.5)).toBeCloseTo(-at(tape, -0.5), 5)
    expect(Math.abs(at(tube, 0.5) + at(tube, -0.5))).toBeGreaterThan(0.05)
    expect(Math.abs(at(tube, 0))).toBeLessThan(0.01)
  })

  it('pumps every so many ms when free, and holds down on the hard shape', () => {
    expect(duckInterval({ rate: 'off', time: 300 }, 120)).toBeCloseTo(0.3)
    expect(duckInterval({ rate: '1/4', time: 300 }, 120)).toBeCloseTo(0.5)
    expect(syncedValue('duck', { rate: '1/4' }, 120)).toBeCloseTo(0.5)
    const soft = duckShape({ release: 60, shape: 'soft' }, 0.5)
    const hard = duckShape({ release: 60, shape: 'hard' }, 0.5)
    const short = duckShape({ release: 60, shape: 'short' }, 0.5)
    expect(hard.hold).toBeGreaterThan(0)
    expect(short.tau).toBeLessThan(soft.tau)
    // A tenth of a second in, the hard pump is still at its floor; the soft one is recovering.
    expect(duckGain(0.1, 0.6, hard.tau, hard.hold)).toBeCloseTo(0.4)
    expect(duckGain(0.1, 0.6, soft.tau, soft.hold)).toBeGreaterThan(0.45)
  })

  it('recovers faster at a higher opto speed', () => {
    const sr = 8000
    const recovery = (speed: number) => {
      const comp = new OptoCompressor(sr)
      for (let i = 0; i < sr; i++) comp.gain(0.9, 1, speed)
      let g = 0
      for (let i = 0; i < sr / 4; i++) g = comp.gain(0, 1, speed)
      return g
    }
    expect(recovery(1)).toBeGreaterThan(recovery(0.5))
    expect(recovery(0.5)).toBeGreaterThan(recovery(0))
  })
})
