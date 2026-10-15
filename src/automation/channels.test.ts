import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../model/factory'
import { normalizeProject } from '../model/migrate'
import { addAutomationPoint, addBus, addEffect, removeEffect, setEffectParam, setMasterVolume, setPan, setVolume } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { availableTargets, effectTarget, resolveTarget } from './targets'
import { connectAutomationWrite } from './write'

const project = () => useProjectStore.getState().project
const lane = (channel: { automation: { target: string; points: { time: number; value: number }[] }[] }, target: string) =>
  channel.automation.find((l) => l.target === target)

beforeEach(() => useProjectStore.getState().load(createProject()))

describe('bus and master automation', () => {
  it('has lanes on buses and the master, but no pan on the master', () => {
    const bus = addBus()
    addAutomationPoint(bus, 'pan', { time: 1, value: 0.2, curve: 0 })
    addAutomationPoint('master', 'volume', { time: 2, value: 0.5, curve: 0 })
    addAutomationPoint('master', 'pan', { time: 2, value: 0.5, curve: 0 })
    expect(lane(project().buses[0], 'pan')!.points).toHaveLength(1)
    expect(lane(project().master, 'volume')!.points).toHaveLength(1)
    expect(lane(project().master, 'pan')).toBeUndefined()
    expect(resolveTarget(project().master, 'pan')).toBeNull()
    expect(availableTargets(project().master).map((t) => t.label)).toEqual(['Volume'])
  })

  it('automates effect knobs on the master and drops the lane with the effect', () => {
    const fx = addEffect('master', 'filter')
    addAutomationPoint('master', effectTarget(fx, 'cutoff'), { time: 0, value: 0.3, curve: 0 })
    expect(availableTargets(project().master).map((t) => t.label)).toContain('Filter · Cutoff')
    removeEffect('master', fx)
    expect(project().master.automation).toEqual([])
  })

  it('loads bus and master lanes, dropping broken ones', () => {
    const bus = addBus()
    addAutomationPoint(bus, 'volume', { time: 1, value: 0.4, curve: 0 })
    addAutomationPoint('master', 'volume', { time: 1, value: 0.6, curve: 0 })
    const raw = JSON.parse(JSON.stringify(project()))
    raw.master.automation.push({ target: 'pan', points: [] })
    const loaded = normalizeProject(raw)
    expect(loaded.buses[0].automation).toEqual(project().buses[0].automation)
    expect(loaded.master.automation).toEqual(project().master.automation)
    const old = normalizeProject({ version: 1, tracks: [], buses: [{ id: 'b1' }] })
    expect(old.buses[0].automation).toEqual([])
    expect(old.master.automation).toEqual([])
  })
})

describe('writing automation', () => {
  connectAutomationWrite()
  const at = (cursor: number) => useTransportStore.setState({ cursor })

  beforeEach(() => {
    useViewStore.setState({ automationWrite: true })
    useTransportStore.setState({ playing: true, cursor: 0 })
  })
  afterEach(() => {
    useViewStore.setState({ automationWrite: false })
    useTransportStore.setState({ playing: false, cursor: 0 })
  })

  it('records a movement into the lane as one undo step, moving the control too', () => {
    const track = project().tracks[0].id
    const before = useProjectStore.getState().history.past.length
    at(1)
    setVolume(track, 0.5)
    at(1.5)
    setVolume(track, 0.8)
    at(2)
    setVolume(track, 1)
    useProjectStore.getState().endGesture()
    const points = lane(project().tracks[0], 'volume')!.points
    expect(points.map((p) => p.time)).toEqual([1, 1.5, 2])
    expect(points[2].value).toBeCloseTo(resolveTarget(project().tracks[0], 'volume')!.fromReal(1))
    expect(project().tracks[0].volume).toBe(1)
    expect(useProjectStore.getState().history.past.length).toBe(before + 1)
    useProjectStore.getState().undo()
    expect(lane(project().tracks[0], 'volume')).toBeUndefined()
  })

  it('replaces what the movement passes over, and thins points that come too fast', () => {
    const track = project().tracks[0].id
    for (const time of [0.5, 1.2, 1.7, 3]) addAutomationPoint(track, 'pan', { time, value: 0.9, curve: 0 })
    const setPanAt = (time: number, pan: number) => {
      at(time)
      setPan(track, pan)
    }
    setPanAt(1, 0)
    setPanAt(1.01, -0.5)
    setPanAt(2, 0.5)
    useProjectStore.getState().endGesture()
    const points = lane(project().tracks[0], 'pan')!.points
    // 1.2 and 1.7 were passed over; 1.01 was too close to 1, so 1 took its value.
    expect(points.map((p) => p.time)).toEqual([0.5, 1, 2, 3])
    expect(points[1].value).toBeCloseTo(0.25)
  })

  it('writes effect knobs and the master, but only while playing with write on', () => {
    const fx = addEffect('master', 'filter')
    at(0.5)
    setEffectParam('master', fx, 'cutoff', 1000)
    setMasterVolume(0.5)
    useProjectStore.getState().endGesture()
    expect(lane(project().master, effectTarget(fx, 'cutoff'))!.points).toHaveLength(1)
    expect(lane(project().master, 'volume')!.points).toHaveLength(1)

    useTransportStore.setState({ playing: false })
    setVolume(project().tracks[1].id, 0.3)
    expect(project().tracks[1].automation).toEqual([])
    expect(project().tracks[1].volume).toBe(0.3)
  })
})
