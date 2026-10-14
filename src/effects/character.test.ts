import { describe, expect, it } from 'vitest'
import { suggestedTail } from '../audio/export'
import { createProject } from '../model/factory'
import { availableTargets } from '../automation/targets'
import { vibratoSwing } from './character'
import { EFFECTS, EFFECT_TYPES, createEffect, duckInterval, formatValue, lfoRate, syncedValue, type NumberParam } from './definitions'
import { DUCK_ATTACK, duckGain, duckPulses, plateImpulse, softClipCurve } from './dsp'
import { BUILT_IN_PRESETS } from './presets'

describe('batch 2 definitions', () => {
  it('lists every effect in a group, batch 2 under character and space', () => {
    const character = EFFECT_TYPES.filter((t) => EFFECTS[t].group === 'character')
    expect(character).toEqual([
      'chorus',
      'phaser',
      'tremolo',
      'vibrato',
      'tape',
      'bitcrusher',
      'clipper',
      'tilt',
      'air',
      'midside',
      'slapback',
      'plate',
      'spread',
      'duck',
    ])
  })

  it('locks tempo-synced numbers to the note length', () => {
    const delay = createEffect('delay', { sync: '1/4' })
    expect(syncedValue('delay', delay.params, 120)).toBe(0.5)
    expect(syncedValue('delay', { ...delay.params, sync: 'off' }, 120)).toBeNull()
    const tremolo = createEffect('tremolo', { sync: '1/8' })
    // An eighth at 120 BPM lasts 0.25 s: 4 cycles a second.
    expect(syncedValue('tremolo', tremolo.params, 120)).toBe(4)
    expect(lfoRate(tremolo.params, 120)).toBe(4)
    expect(lfoRate({ ...tremolo.params, sync: 'off', rate: 6 }, 120)).toBe(6)
    expect(syncedValue('chorus', createEffect('chorus').params, 120)).toBeNull()
    expect(duckInterval({ rate: '1/8' }, 90)).toBeCloseTo(1 / 3)
  })

  it('keeps knobs that rebuild audio out of automation', () => {
    const track = { ...createProject().tracks[0], effects: [createEffect('plate'), createEffect('duck'), createEffect('tremolo')] }
    const labels = availableTargets(track).map((t) => t.label)
    expect(labels).toContain('Plate reverb · Mix')
    expect(labels).not.toContain('Plate reverb · Decay')
    expect(labels.some((l) => l.startsWith('Sidechain duck'))).toBe(false)
    expect(labels).toContain('Tremolo / Auto-pan · Depth')
  })

  it('formats the new units', () => {
    expect(formatValue(EFFECTS.bitcrusher.params[0] as NumberParam, 7.8)).toBe('7 bit')
    expect(formatValue(EFFECTS.bitcrusher.params[1] as NumberParam, 4)).toBe('4.0×')
    expect(formatValue(EFFECTS.bitcrusher.params[1] as NumberParam, 24)).toBe('24×')
  })

  it('gives plate and slapback export tails', () => {
    const p = createProject()
    p.master.effects = [createEffect('plate', { decay: 3, preDelay: 100 })]
    expect(suggestedTail(p)).toBe(4)
    p.master.effects = [createEffect('slapback', { time: 200, feedback: 30 })]
    // Six repeats to fall 60 dB at 30% feedback: 1.2 s, rounded up.
    expect(suggestedTail(p)).toBe(2)
  })

  it('ships presets that use only known effects and valid settings', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const item of preset.chain) {
        const fx = createEffect(item.type, item.params)
        expect(fx.params, `${preset.name}: ${item.type}`).toMatchObject(item.params ?? {})
      }
    }
  })
})

describe('batch 2 signal helpers', () => {
  it('soft clips smoothly into ±1, from hard to soft', () => {
    const at = (curve: Float32Array, v: number) => curve[Math.round(((v / 2 + 1) / 2) * (curve.length - 1))]
    const hard = softClipCurve(0)
    expect(at(hard, 0.5)).toBeCloseTo(0.5, 2)
    expect(at(hard, 1.5)).toBe(1)
    const soft = softClipCurve(1)
    expect(at(soft, 0.4)).toBeCloseTo(0.4, 2)
    expect(at(soft, 0.9)).toBeLessThan(0.9)
    expect(at(soft, 0.9)).toBeGreaterThan(0.5)
    expect(Math.max(...soft)).toBeLessThanOrEqual(1)
    expect(at(soft, -1.5)).toBeCloseTo(-at(soft, 1.5), 5)
  })

  it('makes a plate impulse that decays and darkens', () => {
    const [ir] = plateImpulse(8000, 1, 7, 1)
    expect(ir.length).toBe(8000)
    const energy = (from: number, to: number) => ir.subarray(from, to).reduce((s, v) => s + v * v, 0)
    expect(energy(0, 800)).toBeGreaterThan(energy(7200, 8000) * 100)
    // Brightness: sample-to-sample change shrinks as the filter closes.
    const roughness = (from: number, to: number) => {
      let d = 0
      let e = 0
      for (let i = from + 1; i < to; i++) {
        d += (ir[i] - ir[i - 1]) ** 2
        e += ir[i] ** 2
      }
      return d / e
    }
    expect(roughness(0, 2000)).toBeGreaterThan(roughness(6000, 8000))
  })

  it('pulses the duck on the beat grid and recovers between pulses', () => {
    expect(duckPulses(0, 2, 0.5)).toEqual([0, 0.5, 1, 1.5])
    expect(duckPulses(0.6, 1.6, 0.5)).toEqual([1, 1.5])
    expect(duckPulses(1, 1.4, 0.5)).toEqual([1])
    expect(duckGain(0, 0.6, 0.1)).toBeCloseTo(0.4)
    expect(duckGain(DUCK_ATTACK + 0.1, 0.6, 0.1)).toBeCloseTo(1 - 0.6 * Math.exp(-1))
    expect(duckGain(5, 0.6, 0.1)).toBeCloseTo(1)
  })

  it('scales vibrato depth to the rate, capped', () => {
    // A semitone (≈5.9%) at 5 Hz needs about 1.9 ms of swing.
    expect(vibratoSwing(100, 5)).toBeCloseTo(0.059 / (2 * Math.PI * 5))
    expect(vibratoSwing(50, 5)).toBeCloseTo(vibratoSwing(100, 5) / 2)
    expect(vibratoSwing(100, 0.01)).toBe(0.01)
  })
})
