import { describe, expect, it } from 'vitest'
import { beatsInWindow } from './metronome'

const four4 = { beats: 4, unit: 4 }

describe('beatsInWindow', () => {
  it('lists beats in the window with bar accents', () => {
    // 120 BPM: a beat every 0.5 s.
    expect(beatsInWindow(0, 2.1, 120, four4)).toEqual([
      { time: 0, accent: true },
      { time: 0.5, accent: false },
      { time: 1, accent: false },
      { time: 1.5, accent: false },
      { time: 2, accent: true },
    ])
  })

  it('includes a beat on the window start but not on its end', () => {
    expect(beatsInWindow(0.5, 1, 120, four4).map((b) => b.time)).toEqual([0.5])
  })

  it('handles count-ins before time 0', () => {
    expect(beatsInWindow(-2, 0.1, 120, four4)).toEqual([
      { time: -2, accent: true },
      { time: -1.5, accent: false },
      { time: -1, accent: false },
      { time: -0.5, accent: false },
      { time: 0, accent: true },
    ])
  })

  it('follows the time signature', () => {
    // 6/8 at 120: eighth-note beats of 0.25 s, accent every 6.
    const beats = beatsInWindow(0, 3, 120, { beats: 6, unit: 8 })
    expect(beats).toHaveLength(12)
    expect(beats.filter((b) => b.accent).map((b) => b.time)).toEqual([0, 1.5])
  })
})
