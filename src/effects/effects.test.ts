import { beforeEach, describe, expect, it } from 'vitest'
import { suggestedTail } from '../audio/export'
import { createProject } from '../model/factory'
import { normalizeProject } from '../model/migrate'
import {
  addBus,
  addEffect,
  applyChain,
  moveEffect,
  removeEffect,
  setEffectParam,
  toggleChainBypass,
  toggleEffect,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { EFFECTS } from './definitions'
import { BUILT_IN_PRESETS } from './presets'

const project = () => useProjectStore.getState().project
const track = () => project().tracks[0]

beforeEach(() => useProjectStore.getState().load(createProject()))

describe('effect actions', () => {
  it('adds, reorders, toggles and removes effects', () => {
    const t = track().id
    const eq = addEffect(t, 'eq')
    const comp = addEffect(t, 'compressor')
    const gate = addEffect(t, 'gate', 0)
    expect(track().effects.map((e) => e.type)).toEqual(['gate', 'eq', 'compressor'])
    moveEffect(t, gate, 2)
    expect(track().effects.map((e) => e.id)).toEqual([eq, comp, gate])
    toggleEffect(t, comp)
    expect(track().effects[1].enabled).toBe(false)
    removeEffect(t, eq)
    expect(track().effects.map((e) => e.id)).toEqual([comp, gate])
  })

  it('sets parameters within range, as one undo step per gesture', () => {
    const t = track().id
    const id = addEffect(t, 'filter')
    setEffectParam(t, id, 'cutoff', 500)
    setEffectParam(t, id, 'cutoff', 800)
    setEffectParam(t, id, 'cutoff', 99999)
    expect(track().effects[0].params.cutoff).toBe(20000)
    setEffectParam(t, id, 'nonexistent', 1)
    expect('nonexistent' in track().effects[0].params).toBe(false)
    useProjectStore.getState().undo()
    expect(track().effects[0].params.cutoff).toBe(2000)
  })

  it('works on buses and the master, with chain bypass', () => {
    const bus = addBus()
    addEffect(bus, 'reverb')
    addEffect('master', 'compressor')
    toggleChainBypass('master')
    expect(project().buses[0].effects[0].type).toBe('reverb')
    expect(project().master).toMatchObject({ fxBypass: true, effects: [expect.objectContaining({ type: 'compressor' })] })
  })

  it('applies every built-in preset with valid parameters', () => {
    const t = track().id
    for (const preset of BUILT_IN_PRESETS) {
      applyChain(t, preset.chain, `Preset: ${preset.name}`)
      const effects = track().effects
      expect(effects).toHaveLength(preset.chain.length)
      for (const [i, effect] of effects.entries()) {
        for (const [key, value] of Object.entries(preset.chain[i].params ?? {})) {
          expect(effect.params[key], `${preset.name} ${effect.type}.${key}`).toBe(value)
        }
        expect(Object.keys(effect.params).sort()).toEqual(EFFECTS[effect.type].params.map((p) => p.key).sort())
      }
    }
  })

  it('keeps effects through a save/load round trip', () => {
    const t = track().id
    applyChain(t, BUILT_IN_PRESETS[0].chain, 'Preset')
    const restored = normalizeProject(JSON.parse(JSON.stringify(project())))
    expect(restored.tracks[0].effects).toEqual(project().tracks[0].effects)
  })
})

describe('suggestedTail', () => {
  it('covers reverb decay and delay repeats, ignoring bypassed chains', () => {
    const t = track().id
    expect(suggestedTail(project())).toBe(0)
    applyChain(t, [{ type: 'reverb', params: { decay: 2.5, preDelay: 100 } }], 'x')
    expect(suggestedTail(project())).toBe(3)
    // 1/4 note at 120 BPM = 0.5 s; 50% feedback needs 10 repeats to fall 60 dB.
    applyChain(t, [{ type: 'delay', params: { sync: '1/4', feedback: 50 } }], 'x')
    expect(suggestedTail(project())).toBe(5)
    toggleChainBypass(t)
    expect(suggestedTail(project())).toBe(0)
  })
})
