import { describe, expect, it } from 'vitest'
import { buildTake, type RecordedChunk } from './take'

const SR = 10 // 10 samples per second keeps the arithmetic readable

/** Chunks of 4 samples, counting up from 0, with left = n and right = -n. */
function chunks(count: number, startTime = 0): RecordedChunk[] {
  return Array.from({ length: count }, (_, k) => {
    const values = [0, 1, 2, 3].map((i) => k * 4 + i)
    return { time: startTime + (k * 4) / SR, channels: [Float32Array.from(values), Float32Array.from(values, (v) => -v)] }
  })
}

describe('buildTake', () => {
  it('joins chunks and keeps both channels', () => {
    const [l, r] = buildTake(chunks(2), SR, 0, 'stereo')
    expect(Array.from(l)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(Array.from(r)).toEqual([-0, -1, -2, -3, -4, -5, -6, -7])
  })

  it('drops samples captured before the start time, across chunk boundaries', () => {
    const [l] = buildTake(chunks(3), SR, 0.5, 'left')
    expect(Array.from(l)).toEqual([5, 6, 7, 8, 9, 10, 11])
  })

  it('pads with silence when capture began after the start time', () => {
    const [l] = buildTake(chunks(1, 0.3), SR, 0, 'left')
    expect(Array.from(l)).toEqual([0, 0, 0, 0, 1, 2, 3])
  })

  it('picks or mixes channels', () => {
    expect(Array.from(buildTake(chunks(1), SR, 0, 'right')[0])).toEqual([-0, -1, -2, -3])
    expect(Array.from(buildTake(chunks(1), SR, 0, 'mono')[0])).toEqual([0, 0, 0, 0])
  })

  it('treats a mono input as both channels', () => {
    const mono: RecordedChunk[] = [{ time: 0, channels: [Float32Array.from([1, 2])] }]
    expect(buildTake(mono, SR, 0, 'stereo').map((c) => Array.from(c))).toEqual([
      [1, 2],
      [1, 2],
    ])
    expect(Array.from(buildTake(mono, SR, 0, 'right')[0])).toEqual([1, 2])
  })

  it('returns nothing for no input or a start after the end', () => {
    expect(buildTake([], SR, 0, 'stereo')).toEqual([])
    expect(buildTake(chunks(1), SR, 5, 'left')[0]).toHaveLength(0)
  })
})
