import { describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import type { Clip, Project } from '../model/types'
import { DECLICK, PlaybackPlanner, clipEvents, gainEnvelope, trackIsAudible, trimEventStart } from './schedule'

function projectWith(clips: Partial<Clip>[]): Project {
  const p = createProject()
  p.tracks[0].clips = clips.map((c, i) => createClip({ name: `c${i}`, assetId: 'a', start: 0, duration: 2, ...c }))
  return p
}

describe('clipEvents', () => {
  it('starts clips that begin inside the window', () => {
    const p = projectWith([{ start: 1, duration: 2, offset: 0.5 }])
    const [ev] = clipEvents(p, { from: 0, to: 1.5, catchUp: false })
    expect(ev).toMatchObject({ at: 1, clipTime: 0, assetOffset: 0.5, duration: 2 })
  })

  it('skips clips outside the window', () => {
    const p = projectWith([{ start: 5 }, { start: 0, duration: 1 }])
    expect(clipEvents(p, { from: 1, to: 2, catchUp: true })).toHaveLength(0)
  })

  it('joins a clip mid-way only when catching up', () => {
    const p = projectWith([{ start: 0, duration: 4, offset: 1 }])
    expect(clipEvents(p, { from: 1.5, to: 2, catchUp: false })).toHaveLength(0)
    const [ev] = clipEvents(p, { from: 1.5, to: 2, catchUp: true })
    expect(ev).toMatchObject({ at: 1.5, clipTime: 1.5, assetOffset: 2.5, duration: 2.5 })
  })

  it('never schedules a clip twice across adjacent windows', () => {
    const p = projectWith([{ start: 1, duration: 1 }])
    const a = clipEvents(p, { from: 0, to: 1, catchUp: true })
    const b = clipEvents(p, { from: 1, to: 2, catchUp: false })
    expect(a.length + b.length).toBe(1)
  })

  it('cuts voices at cutAt', () => {
    const p = projectWith([{ start: 1, duration: 4 }])
    const [ev] = clipEvents(p, { from: 0, to: 2, catchUp: true, cutAt: 2 })
    expect(ev.duration).toBe(1)
  })
})

describe('trackIsAudible', () => {
  it('applies mute and solo', () => {
    const p = createProject()
    const [a, b] = p.tracks
    expect(trackIsAudible(a, p.tracks)).toBe(true)
    b.solo = true
    expect(trackIsAudible(a, p.tracks)).toBe(false)
    expect(trackIsAudible(b, p.tracks)).toBe(true)
    b.muted = true
    expect(trackIsAudible(b, p.tracks)).toBe(false)
  })
})

describe('trimEventStart', () => {
  it('moves the start forward and drops fully-late events', () => {
    const [ev] = clipEvents(projectWith([{ start: 0, duration: 1 }]), { from: 0, to: 1, catchUp: true })
    expect(trimEventStart(ev, 0.25)).toMatchObject({ at: 0.25, clipTime: 0.25, assetOffset: 0.25, duration: 0.75 })
    expect(trimEventStart(ev, 0)).toBe(ev)
    expect(trimEventStart(ev, 1)).toBeNull()
  })
})

describe('gainEnvelope', () => {
  const eventFor = (clip: Partial<Clip>, from = 0, cutAt?: number) =>
    clipEvents(projectWith([clip]), { from, to: 100, catchUp: true, cutAt })[0]

  it('is flat at clip gain without fades', () => {
    expect(gainEnvelope(eventFor({ duration: 2, gain: 0.5 }))).toEqual([
      { time: 0, value: 0.5 },
      { time: 2, value: 0.5 },
    ])
  })

  it('ramps fade-in and fade-out', () => {
    const env = gainEnvelope(eventFor({ duration: 4, fadeIn: 1, fadeOut: 2 }))
    expect(env).toEqual([
      { time: 0, value: 0 },
      { time: 1, value: 1 },
      { time: 2, value: 1 },
      { time: 4, value: 0 },
    ])
  })

  it('declicks when joining or leaving a clip mid-way', () => {
    const env = gainEnvelope(eventFor({ duration: 4 }, 1, 3))
    expect(env[0]).toEqual({ time: 0, value: 0 })
    expect(env[1].time).toBeCloseTo(DECLICK)
    expect(env.at(-1)).toEqual({ time: 2, value: 0 })
    expect(env.at(-2)?.time).toBeCloseTo(2 - DECLICK)
  })

  it('keeps point times strictly increasing', () => {
    // Fade-in boundary falls inside the start declick window.
    const env = gainEnvelope(eventFor({ duration: 4, fadeIn: 1.002 }, 1))
    for (let i = 1; i < env.length; i++) expect(env[i].time).toBeGreaterThan(env[i - 1].time)
  })
})

describe('PlaybackPlanner', () => {
  const noLoop = { enabled: false, start: 0, end: 8 }

  it('hands out contiguous windows and tracks position', () => {
    const planner = new PlaybackPlanner(10, 2)
    const first = planner.plan(10.1, noLoop)
    expect(first).toHaveLength(1)
    expect(first[0].window).toMatchObject({ catchUp: true })
    expect(first[0].window.from).toBeCloseTo(2)
    expect(first[0].window.to).toBeCloseTo(2.1)
    expect(first[0].ctxOffset).toBeCloseTo(8)
    const second = planner.plan(10.2, noLoop)
    expect(second[0].window.from).toBeCloseTo(2.1)
    expect(second[0].window.catchUp).toBe(false)
    expect(planner.positionAt(10.15)).toBeCloseTo(2.15)
  })

  it('wraps at the loop end and catches up after the wrap', () => {
    const loop = { enabled: true, start: 1, end: 2 }
    const planner = new PlaybackPlanner(0, 1.9)
    const windows = planner.plan(0.3, loop)
    expect(windows).toHaveLength(2)
    expect(windows[0].window.from).toBeCloseTo(1.9)
    expect(windows[0].window.to).toBe(2)
    expect(windows[0].window.cutAt).toBe(2)
    expect(windows[1].window.from).toBe(1)
    expect(windows[1].window.catchUp).toBe(true)
    expect(windows[1].ctxOffset).toBeCloseTo(-0.9)
    expect(planner.positionAt(0.05)).toBeCloseTo(1.95)
    expect(planner.positionAt(0.2)).toBeCloseTo(1.1)
  })

  it('plays straight through when starting after the loop end', () => {
    const loop = { enabled: true, start: 1, end: 2 }
    const planner = new PlaybackPlanner(0, 3)
    const [w] = planner.plan(1, loop)
    expect(w.window.from).toBe(3)
    expect(w.window.to).toBeCloseTo(4)
    expect(w.window.cutAt).toBeUndefined()
  })

  it('ignores a loop too short to use', () => {
    const planner = new PlaybackPlanner(0, 1)
    expect(planner.plan(1, { enabled: true, start: 1, end: 1.01 })).toHaveLength(1)
  })
})
