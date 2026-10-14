import { describe, expect, it } from 'vitest'
import { curveForMidpoint, insertPoint, inverseShape, sampleRange, segmentMidpoint, shape, valueAt } from './curve'

const p = (time: number, value: number, curve = 0) => ({ time, value, curve })

describe('shape', () => {
  it('is linear at 0 and keeps the ends fixed for any curve', () => {
    expect(shape(0.3, 0)).toBe(0.3)
    for (const c of [-1, -0.4, 0.5, 1]) {
      expect(shape(0, c)).toBeCloseTo(0)
      expect(shape(1, c)).toBeCloseTo(1)
      expect(inverseShape(shape(0.37, c), c)).toBeCloseTo(0.37)
    }
  })

  it('bends one way for positive curves and the other for negative', () => {
    expect(shape(0.5, 0.5)).toBeLessThan(0.5)
    expect(shape(0.5, -0.5)).toBeGreaterThan(0.5)
  })
})

describe('valueAt', () => {
  const points = [p(1, 0.2), p(3, 0.8), p(4, 0.4)]

  it('holds the first and last values outside the points', () => {
    expect(valueAt(points, 0)).toBe(0.2)
    expect(valueAt(points, 10)).toBe(0.4)
    expect(valueAt([], 1)).toBeNull()
  })

  it('interpolates between points', () => {
    expect(valueAt(points, 2)).toBeCloseTo(0.5)
    expect(valueAt(points, 3.5)).toBeCloseTo(0.6)
    expect(valueAt(points, 3)).toBeCloseTo(0.8)
  })

  it('follows the segment curve', () => {
    const bent = [p(0, 0, 0.8), p(1, 1)]
    expect(valueAt(bent, 0.5)).toBeCloseTo(shape(0.5, 0.8))
  })
})

describe('sampleRange', () => {
  it('includes the range ends, inner points and regular steps', () => {
    const samples = sampleRange([p(0, 0), p(0.025, 1)], 0, 0.05, 0.01)
    const times = samples.map((s) => s.time)
    expect(times[0]).toBe(0)
    expect(times.at(-1)).toBe(0.05)
    expect(times).toContain(0.025)
    expect(times).toContain(0.01)
    expect(samples.find((s) => s.time === 0.025)?.value).toBe(1)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('returns nothing for an empty lane', () => {
    expect(sampleRange([], 0, 1)).toEqual([])
  })
})

describe('bend handle', () => {
  it('finds the curve that puts the midpoint where it was dragged', () => {
    const a = p(0, 0.2)
    const b = p(2, 0.8)
    for (const target of [0.3, 0.5, 0.7]) {
      const curve = curveForMidpoint(a, b, target)
      expect(segmentMidpoint({ ...a, curve }, b).value).toBeCloseTo(target, 2)
    }
    expect(curveForMidpoint(p(0, 0.5), p(1, 0.5), 0.9)).toBe(0)
  })
})

describe('insertPoint', () => {
  it('keeps points sorted and replaces a point at the same time', () => {
    const points = insertPoint(insertPoint([p(2, 0.5)], p(1, 0.1)), p(2, 0.9))
    expect(points).toEqual([p(1, 0.1), p(2, 0.9)])
  })
})
