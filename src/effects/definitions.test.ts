import { describe, expect, it } from 'vitest'
import {
  EFFECTS,
  EFFECT_TYPES,
  createEffect,
  delaySeconds,
  findParam,
  formatValue,
  fromNormalized,
  normalizeEffect,
  toNormalized,
  type NumberParam,
} from './definitions'

describe('effect definitions', () => {
  it('has valid defaults inside every range', () => {
    for (const type of EFFECT_TYPES) {
      for (const p of EFFECTS[type].params) {
        if (p.kind === 'number') {
          expect(p.default, `${type}.${p.key}`).toBeGreaterThanOrEqual(p.min)
          expect(p.default, `${type}.${p.key}`).toBeLessThanOrEqual(p.max)
          if (p.scale === 'log') expect(p.min, `${type}.${p.key}`).toBeGreaterThan(0)
        }
        if (p.kind === 'choice') expect(p.options.map((o) => o.value)).toContain(p.default)
      }
    }
  })

  it('creates effects with every parameter set', () => {
    const fx = createEffect('delay', { mix: 50, bogus: 1 })
    expect(fx).toMatchObject({ type: 'delay', enabled: true })
    expect(fx.params).toMatchObject({ mix: 50, feedback: 35, sync: '1/8', pingPong: false })
    expect('bogus' in fx.params).toBe(false)
  })

  it('repairs stored effects and rejects unknown ones', () => {
    expect(normalizeEffect({ id: 'fx1', type: 'eq', params: { lowGain: 99, midFreq: 'loud' } })).toMatchObject({
      id: 'fx1',
      enabled: true,
      params: { lowGain: 18, midFreq: 1000, highGain: 0 },
    })
    expect(normalizeEffect({ id: 'fx2', type: 'filter', enabled: false, params: { mode: 'notch' } })?.params.mode).toBe('lowpass')
    expect(normalizeEffect({ id: 'fx3', type: 'kazoo' })).toBeNull()
    expect(normalizeEffect(null)).toBeNull()
  })
})

describe('knob mapping', () => {
  const cutoff = findParam('filter', 'cutoff') as NumberParam
  const gain = findParam('eq', 'lowGain') as NumberParam

  it('maps log parameters by octave', () => {
    expect(fromNormalized(cutoff, 0)).toBeCloseTo(20)
    expect(fromNormalized(cutoff, 1)).toBeCloseTo(20000)
    expect(fromNormalized(cutoff, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000))
    expect(toNormalized(cutoff, fromNormalized(cutoff, 0.37))).toBeCloseTo(0.37)
  })

  it('maps linear parameters evenly and clamps the position', () => {
    expect(fromNormalized(gain, 0.5)).toBe(0)
    expect(fromNormalized(gain, 2)).toBe(18)
    expect(toNormalized(gain, -18)).toBe(0)
  })

  it('formats values with units', () => {
    expect(formatValue(cutoff, 1500)).toBe('1.50 kHz')
    expect(formatValue(cutoff, 440)).toBe('440 Hz')
    expect(formatValue(gain, 3)).toBe('+3.0 dB')
    expect(formatValue(findParam('compressor', 'ratio') as NumberParam, 4)).toBe('4.0:1')
  })
})

describe('delaySeconds', () => {
  it('uses the synced note length at the tempo, or the free time', () => {
    expect(delaySeconds({ sync: '1/4', time: 100 }, 120)).toBe(0.5)
    expect(delaySeconds({ sync: '1/8d', time: 100 }, 120)).toBe(0.375)
    expect(delaySeconds({ sync: 'off', time: 300 }, 120)).toBe(0.3)
  })
})
