import { beforeEach, describe, expect, it } from 'vitest'
import { faderToGain } from '../model/levels'
import { createProject } from '../model/factory'
import { normalizeProject } from '../model/migrate'
import {
  addAutomationLane,
  addAutomationPoint,
  addEffect,
  applyChain,
  deleteAutomationPoint,
  moveAutomationPoint,
  removeAutomationLane,
  removeEffect,
  setAutomationCurve,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { availableTargets, effectTarget, parseTarget, resolveTarget } from './targets'

const track = () => useProjectStore.getState().project.tracks[0]
const lane = (target: string) => track().automation.find((l) => l.target === target)

beforeEach(() => useProjectStore.getState().load(createProject()))

describe('targets', () => {
  it('parses lane keys', () => {
    expect(parseTarget('volume')).toEqual({ kind: 'volume' })
    expect(parseTarget('fx:fx_1:cutoff')).toEqual({ kind: 'effect', effectId: 'fx_1', param: 'cutoff' })
    expect(parseTarget('nonsense')).toBeNull()
  })

  it('maps lane values onto each control scale', () => {
    const t = track().id
    const id = addEffect(t, 'filter')
    const volume = resolveTarget(track(), 'volume')!
    expect(volume.toReal(0.5)).toBeCloseTo(faderToGain(0.5))
    expect(volume.fromReal(1)).toBeCloseTo(0.794, 3)
    expect(resolveTarget(track(), 'pan')!.toReal(0)).toBe(-1)
    const cutoff = resolveTarget(track(), effectTarget(id, 'cutoff'))!
    expect(cutoff.toReal(0.5)).toBeCloseTo(Math.sqrt(20 * 20000))
    expect(cutoff.label).toBe('Filter · Cutoff')
    expect(cutoff.format(1)).toBe('20.0 kHz')
  })

  it('lists automatable targets, leaving out parameters that rebuild the sound', () => {
    const t = track().id
    addEffect(t, 'reverb')
    const labels = availableTargets(track()).map((x) => x.label)
    expect(labels.slice(0, 2)).toEqual(['Volume', 'Pan'])
    expect(labels).toContain('Reverb · Mix')
    expect(labels).not.toContain('Reverb · Decay')
    expect(resolveTarget(track(), effectTarget(track().effects[0].id, 'decay'))).toBeNull()
  })
})

describe('automation actions', () => {
  it('adds points in time order, creating the lane on first use', () => {
    const t = track().id
    expect(addAutomationPoint(t, 'volume', { time: 2, value: 0.5, curve: 0 })).toBe(0)
    expect(addAutomationPoint(t, 'volume', { time: 1, value: 0.9, curve: 0 })).toBe(0)
    expect(lane('volume')!.points.map((p) => p.time)).toEqual([1, 2])
    addAutomationPoint(t, 'volume', { time: 3, value: 7, curve: 0 })
    expect(lane('volume')!.points[2].value).toBe(1)
  })

  it('moves a point between its neighbours as one undo step', () => {
    const t = track().id
    for (const time of [1, 2, 3]) addAutomationPoint(t, 'pan', { time, value: 0.5, curve: 0 })
    moveAutomationPoint(t, 'pan', 1, 2.5, 0.8)
    moveAutomationPoint(t, 'pan', 1, 9, 0.9)
    useProjectStore.getState().endGesture()
    const middle = lane('pan')!.points[1]
    expect(middle.time).toBeCloseTo(2.999)
    expect(middle.value).toBe(0.9)
    useProjectStore.getState().undo()
    expect(lane('pan')!.points[1]).toMatchObject({ time: 2, value: 0.5 })
  })

  it('bends, deletes points and removes lanes', () => {
    const t = track().id
    addAutomationPoint(t, 'volume', { time: 0, value: 0, curve: 0 })
    addAutomationPoint(t, 'volume', { time: 1, value: 1, curve: 0 })
    setAutomationCurve(t, 'volume', 0, 5)
    expect(lane('volume')!.points[0].curve).toBe(1)
    deleteAutomationPoint(t, 'volume', 0)
    expect(lane('volume')!.points).toHaveLength(1)
    removeAutomationLane(t, 'volume')
    expect(lane('volume')).toBeUndefined()
  })

  it('creates empty lanes only for valid targets, once', () => {
    const t = track().id
    addAutomationLane(t, 'volume')
    addAutomationLane(t, 'volume')
    addAutomationLane(t, 'fx:missing:cutoff')
    expect(track().automation).toEqual([{ target: 'volume', points: [] }])
  })

  it('drops lanes of effects that are removed or replaced', () => {
    const t = track().id
    const filter = addEffect(t, 'filter')
    const eq = addEffect(t, 'eq')
    addAutomationPoint(t, effectTarget(filter, 'cutoff'), { time: 0, value: 0.2, curve: 0 })
    addAutomationPoint(t, effectTarget(eq, 'midGain'), { time: 0, value: 0.7, curve: 0 })
    addAutomationPoint(t, 'volume', { time: 0, value: 0.7, curve: 0 })
    removeEffect(t, filter)
    expect(track().automation.map((l) => l.target)).toEqual([effectTarget(eq, 'midGain'), 'volume'])
    applyChain(t, [{ type: 'compressor' }], 'Preset')
    expect(track().automation.map((l) => l.target)).toEqual(['volume'])
  })
})

describe('loading', () => {
  it('keeps valid lanes and repairs or drops broken ones', () => {
    const t = track().id
    const id = addEffect(t, 'filter')
    addAutomationPoint(t, effectTarget(id, 'cutoff'), { time: 1, value: 0.4, curve: 0.3 })
    const raw = JSON.parse(JSON.stringify(useProjectStore.getState().project))
    raw.tracks[0].automation.push(
      { target: 'pan', points: [{ time: 3, value: 2, curve: 9 }, { time: 1, value: 0.5 }, { time: 'x', value: 1 }] },
      { target: 'fx:gone:cutoff', points: [] },
      { target: 'pan', points: [] },
    )
    const tr = normalizeProject(raw).tracks[0]
    expect(tr.automation.map((l) => l.target)).toEqual([effectTarget(id, 'cutoff'), 'pan'])
    expect(tr.automation[1].points).toEqual([
      { time: 1, value: 0.5, curve: 0 },
      { time: 3, value: 1, curve: 1 },
    ])
  })
})
