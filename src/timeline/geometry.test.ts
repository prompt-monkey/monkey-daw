import { describe, expect, it } from 'vitest'
import { barLabelStep, laneGridBackground, rulerTicks } from './geometry'

const four4 = { beats: 4, unit: 4 }

describe('rulerTicks', () => {
  it('labels every bar and shows beats when zoomed in', () => {
    // 120 BPM 4/4: bars are 2 s, 200 px at 100 px/s.
    const ticks = rulerTicks(100, 120, four4, 0, 4)
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(['1', '2', '3'])
    expect(ticks.filter((t) => t.kind === 'beat')).toHaveLength(6)
  })

  it('thins labels and hides beats when zoomed out', () => {
    // Bars are 8 px at 4 px/s.
    expect(barLabelStep(4, 120, four4)).toBe(8)
    const ticks = rulerTicks(4, 120, four4, 0, 64)
    expect(ticks.some((t) => t.kind === 'beat')).toBe(false)
    // 64 s is the start of bar 33, and the range end is inclusive.
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(['1', '9', '17', '25', '33'])
  })

  it('only returns ticks inside the range', () => {
    const ticks = rulerTicks(100, 120, four4, 3, 5)
    expect(ticks.every((t) => t.time >= 3 && t.time <= 5)).toBe(true)
    expect(ticks.find((t) => t.label)?.label).toBe('3')
  })
})

describe('laneGridBackground', () => {
  it('draws bar and beat lines at their spacing', () => {
    expect(laneGridBackground(100, 120, four4).backgroundSize).toBe('200px 100%, 50px 100%')
  })

  it('drops beat lines when they would be too dense', () => {
    expect(laneGridBackground(10, 120, four4).backgroundSize).toBe('20px 100%')
  })
})
