import { describe, expect, it } from 'vitest'
import { computePeaks, peakRange } from './peaks'

describe('peaks', () => {
  it('takes min and max per block across channels', () => {
    const left = new Float32Array([0.1, -0.5, 0.2, 0.9, 0])
    const right = new Float32Array([0.3, 0, -0.8, 0, 0.4])
    const { min, max } = computePeaks([left, right], 2)
    expect(Array.from(min)).toEqual([-0.5, -0.8, 0].map(Math.fround))
    expect(Array.from(max)).toEqual([0.3, 0.9, 0.4].map(Math.fround))
  })

  it('aggregates the blocks covering a time span', () => {
    const peaks = { blockDuration: 1, min: new Float32Array([-0.1, -0.7, -0.2]), max: new Float32Array([0.2, 0.1, 0.6]) }
    expect(peakRange(peaks, 0, 2)).toEqual([Math.fround(-0.7), Math.fround(0.2)])
    expect(peakRange(peaks, 2.2, 2.4)).toEqual([Math.fround(-0.2), Math.fround(0.6)])
  })
})
