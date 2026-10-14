import { describe, expect, it } from 'vitest'
import { FrameMonitor, liteActive } from './shell'

describe('lite mode', () => {
  it('follows the preference, or the automatic decision in Auto', () => {
    expect(liteActive({ litePreference: 'on', autoLite: false })).toBe(true)
    expect(liteActive({ litePreference: 'off', autoLite: true })).toBe(false)
    expect(liteActive({ litePreference: 'auto', autoLite: true })).toBe(true)
    expect(liteActive({ litePreference: 'auto', autoLite: false })).toBe(false)
  })
})

describe('FrameMonitor', () => {
  const run = (monitor: FrameMonitor, gaps: number[], active = true) => {
    let now = 1000
    let slow = monitor.frame(now, active)
    for (const gap of gaps) {
      now += gap
      slow = monitor.frame(now, active) || slow
    }
    return slow
  }

  it('stays calm with smooth frames and the odd hiccup', () => {
    expect(run(new FrameMonitor(), Array.from({ length: 300 }, (_, i) => (i % 20 === 0 ? 80 : 16)))).toBe(false)
  })

  it('reports playback that keeps dropping frames', () => {
    expect(run(new FrameMonitor(), Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 70 : 16)))).toBe(true)
  })

  it('ignores frames while not playing, and the gap after a pause', () => {
    const monitor = new FrameMonitor()
    expect(run(monitor, Array.from({ length: 200 }, () => 100), false)).toBe(false)
    // One long gap (the page was hidden) followed by smooth frames.
    expect(run(monitor, [5000, ...Array.from({ length: 150 }, () => 16)])).toBe(false)
  })
})
