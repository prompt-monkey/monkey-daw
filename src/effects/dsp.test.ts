import { describe, expect, it } from 'vitest'
import { mixGains, reverbImpulse, saturationCurve, seedFromId, seededRandom } from './dsp'

describe('seededRandom', () => {
  it('repeats for the same seed and differs between seeds', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const c = seededRandom(43)
    const seqA = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(seqA)
    expect([c(), c(), c()]).not.toEqual(seqA)
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('derives stable seeds from ids', () => {
    expect(seedFromId('fx_abc')).toBe(seedFromId('fx_abc'))
    expect(seedFromId('fx_abc')).not.toBe(seedFromId('fx_abd'))
  })
})

describe('reverbImpulse', () => {
  const rms = (d: Float32Array, from: number, to: number) => {
    let s = 0
    for (let i = from; i < to; i++) s += d[i] * d[i]
    return Math.sqrt(s / (to - from))
  }

  it('lasts the decay time and falls about 60 dB by the end', () => {
    const [left, right] = reverbImpulse(1000, 2, 7)
    expect(left).toHaveLength(2000)
    const start = rms(left, 10, 110)
    const end = rms(left, 1890, 1990)
    expect(20 * Math.log10(end / start)).toBeLessThan(-50)
    expect(20 * Math.log10(end / start)).toBeGreaterThan(-70)
    // Channels are decorrelated, not copies.
    expect(Array.from(left.slice(100, 110))).not.toEqual(Array.from(right.slice(100, 110)))
  })

  it('is identical for the same seed', () => {
    expect(reverbImpulse(1000, 0.5, 3)[0]).toEqual(reverbImpulse(1000, 0.5, 3)[0])
  })
})

describe('saturationCurve', () => {
  it('is odd-symmetric, hits ±1 at the ends and boosts quiet input with more drive', () => {
    const curve = saturationCurve(12, 1001)
    expect(curve[0]).toBeCloseTo(-1)
    expect(curve[1000]).toBeCloseTo(1)
    expect(curve[500]).toBeCloseTo(0)
    expect(curve[750]).toBeCloseTo(-curve[250])
    expect(saturationCurve(24, 1001)[600]).toBeGreaterThan(saturationCurve(0, 1001)[600])
  })
})

describe('mixGains', () => {
  it('crossfades with equal power', () => {
    expect(mixGains(0)).toEqual({ dry: 1, wet: 0 })
    expect(mixGains(1).dry).toBeCloseTo(0)
    expect(mixGains(1).wet).toBeCloseTo(1)
    const half = mixGains(0.5)
    expect(half.dry ** 2 + half.wet ** 2).toBeCloseTo(1)
  })
})
