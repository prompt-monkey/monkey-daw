import { describe, expect, it } from 'vitest'
import { EFFECT_TYPES, createEffect } from './definitions'
import { biquadDb, effectViz, vizPath } from './viz'

describe('effect card pictures', () => {
  it('draws every effect with points inside the box', () => {
    for (const type of EFFECT_TYPES) {
      const viz = effectViz(createEffect(type), 120)
      expect(viz.points.length, type).toBeGreaterThan(0)
      for (const [x, y] of viz.points) {
        expect(x >= 0 && x <= 1 && y >= 0 && y <= 1, type).toBe(true)
      }
      expect(vizPath(viz, 160, 36)).toMatch(/^M/)
    }
  })

  it('computes filter responses like Web Audio', () => {
    expect(biquadDb({ type: 'lowpass', freq: 1000 }, 1000)).toBeCloseTo(-3, 0)
    expect(biquadDb({ type: 'lowpass', freq: 1000 }, 100)).toBeCloseTo(0, 1)
    expect(biquadDb({ type: 'peaking', freq: 1000, q: 1, gain: 6 }, 1000)).toBeCloseTo(6, 1)
    expect(biquadDb({ type: 'highshelf', freq: 1000, gain: -6 }, 15000)).toBeCloseTo(-6, 0)
    expect(biquadDb({ type: 'lowshelf', freq: 1000, gain: 6 }, 30)).toBeCloseTo(6, 0)
  })

  it('follows the settings', () => {
    const flat = effectViz(createEffect('eq'), 120)
    const boosted = effectViz(createEffect('eq', { midGain: 12 }), 120)
    // Flat above the 20 Hz low cut.
    expect(flat.points.filter(([x]) => x > 0.1).every(([, y]) => Math.abs(y - 0.5) < 0.01)).toBe(true)
    expect(Math.min(...boosted.points.map(([, y]) => y))).toBeLessThan(0.25)
    // More feedback, more echoes.
    const few = effectViz(createEffect('delay', { feedback: 10 }), 120).points.length
    const many = effectViz(createEffect('delay', { feedback: 80 }), 120).points.length
    expect(many).toBeGreaterThan(few)
  })
})
