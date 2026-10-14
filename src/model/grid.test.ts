import { describe, expect, it } from 'vitest'
import { barBeatAt, formatTime, secondsPerBar, secondsPerBeat, snapTime } from './grid'

const four4 = { beats: 4, unit: 4 }
const six8 = { beats: 6, unit: 8 }

describe('grid', () => {
  it('measures beats and bars from quarter-note BPM', () => {
    expect(secondsPerBeat(120, four4)).toBe(0.5)
    expect(secondsPerBar(120, four4)).toBe(2)
    expect(secondsPerBeat(120, six8)).toBe(0.25)
    expect(secondsPerBar(120, six8)).toBe(1.5)
  })

  it('snaps to the nearest grid line', () => {
    expect(snapTime(1.26, 'beat', 120, four4)).toBe(1.5)
    expect(snapTime(1.24, 'beat', 120, four4)).toBe(1)
    expect(snapTime(2.9, 'bar', 120, four4)).toBe(2)
    expect(snapTime(1.234, 'off', 120, four4)).toBe(1.234)
    expect(snapTime(-1, 'beat', 120, four4)).toBe(0)
  })

  it('reports 1-based bar and beat', () => {
    expect(barBeatAt(0, 120, four4)).toEqual({ bar: 1, beat: 1 })
    expect(barBeatAt(2.5, 120, four4)).toEqual({ bar: 2, beat: 2 })
    expect(barBeatAt(1.5, 120, six8)).toEqual({ bar: 2, beat: 1 })
  })

  it('formats time as mm:ss.mmm', () => {
    expect(formatTime(0)).toBe('00:00.000')
    expect(formatTime(75.5)).toBe('01:15.500')
  })
})
