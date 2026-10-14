import { describe, expect, it } from 'vitest'
import { MAX_GAIN, dbToGain, faderToGain, formatDb, gainToDb, gainToFader, meterPosition } from './levels'

describe('levels', () => {
  it('converts between gain and dB', () => {
    expect(gainToDb(1)).toBe(0)
    expect(gainToDb(0)).toBe(-Infinity)
    expect(dbToGain(-Infinity)).toBe(0)
    expect(dbToGain(gainToDb(0.3))).toBeCloseTo(0.3)
  })

  it('maps fader travel to gain and back', () => {
    expect(faderToGain(0)).toBe(0)
    expect(faderToGain(1)).toBe(MAX_GAIN)
    expect(gainToFader(1)).toBeCloseTo(0.794, 3)
    for (const g of [0, 0.1, 0.5, 1, 1.7, 2]) expect(faderToGain(gainToFader(g))).toBeCloseTo(g)
    expect(gainToFader(5)).toBe(1)
  })

  it('formats dB for display', () => {
    expect(formatDb(1)).toBe('+0.0')
    expect(formatDb(0.5)).toBe('-6.0')
    expect(formatDb(2)).toBe('+6.0')
    expect(formatDb(0)).toBe('-∞')
  })

  it('positions levels on the meter scale', () => {
    expect(meterPosition(0)).toBe(0)
    expect(meterPosition(dbToGain(-60))).toBe(0)
    expect(meterPosition(dbToGain(6))).toBe(1)
    expect(meterPosition(1)).toBeCloseTo(60 / 66)
    expect(meterPosition(10)).toBe(1)
  })
})
