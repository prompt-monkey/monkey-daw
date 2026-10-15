import { beforeEach, describe, expect, it } from 'vitest'
import { clipEvents, trimEventStart } from '../audio/schedule'
import { neededStretches } from '../audio/stretch'
import { timeStretch } from '../audio/wsola'
import { addAudioClip, setBpm, setClipSourceBpm, setSyncMode } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { trimEnd, trimStart } from '../timeline/edits'
import { createClip, createMidiClip, createProject } from './factory'
import { normalizeProject } from './migrate'
import { clipRate, detectBpm } from './tempo'
import type { AudioClip } from './types'

describe('detectBpm', () => {
  it('reads tempos labelled BPM in any common spelling', () => {
    expect(detectBpm('Guitar Loop 95bpm')).toBe(95)
    expect(detectBpm('drums_128_BPM_Am')).toBe(128)
    expect(detectBpm('keys-bpm140')).toBe(140)
    expect(detectBpm('Pad 87.5 BPM')).toBe(87.5)
    expect(detectBpm('weird 999 bpm')).toBeNull()
  })

  it('trusts a bare number only when the sample lasts whole beats at that tempo', () => {
    // 4 beats at 92 BPM = 2.6087 s.
    expect(detectBpm('Guitar_92_Am', 2.6087)).toBe(92)
    expect(detectBpm('Guitar_92_Am', 2.3)).toBeNull()
    expect(detectBpm('Guitar_92_Am')).toBeNull()
    // One-shots and other numbers don't count.
    expect(detectBpm('Kick 808', 0.5)).toBeNull()
    expect(detectBpm('Snare 02', 0.3)).toBeNull()
  })
})

describe('synced clips', () => {
  const asset = (name: string, duration: number) => ({ id: `ast_${name}`, name, duration, sampleRate: 44100, channels: 2 })
  const clip = () => useProjectStore.getState().project.tracks[0].clips[0] as AudioClip

  beforeEach(() => useProjectStore.getState().load(createProject()))

  it('sync on placement when the name gives the tempo', () => {
    // 4 s of audio at 60 BPM, in a 120 BPM project: plays twice as fast, 2 s long.
    addAudioClip(useProjectStore.getState().project.tracks[0].id, asset('Loop 60bpm', 4), 1)
    expect(clip()).toMatchObject({ sourceBpm: 60, start: 1, duration: 2 })
    expect(clipRate(clip(), 120)).toBe(2)
    addAudioClip(useProjectStore.getState().project.tracks[1].id, asset('Vocal', 4), 0)
    expect(useProjectStore.getState().project.tracks[1].clips[0]).not.toHaveProperty('sourceBpm')
  })

  it('keep their bars when the tempo changes; their offset stays in audio seconds', () => {
    addAudioClip(useProjectStore.getState().project.tracks[0].id, asset('Loop 60bpm', 4), 2)
    useProjectStore.getState().update('trim', (p) => void (p.tracks[0].clips[0].offset = 1))
    setBpm(60)
    expect(clip()).toMatchObject({ start: 4, duration: 4, offset: 1 })
    expect(clipRate(clip(), 60)).toBe(1)
  })

  it('can be synced and unsynced by hand, keeping the same audio', () => {
    useProjectStore.getState().update('add', (p) => {
      p.tracks[0].clips.push(createClip({ name: 'Vocal', assetId: 'a', start: 0, duration: 4, fadeOut: 1 }))
    })
    setClipSourceBpm(clip().id, 60)
    expect(clip()).toMatchObject({ sourceBpm: 60, duration: 2, fadeOut: 0.5 })
    setClipSourceBpm(clip().id, 1000)
    expect(clip().sourceBpm).toBe(60)
    setClipSourceBpm(clip().id, null)
    expect(clip()).toMatchObject({ duration: 4, fadeOut: 1 })
    expect(clip()).not.toHaveProperty('sourceBpm')
  })

  it('schedule their audio at the clip rate', () => {
    const p = createProject()
    p.tracks[0].clips = [createClip({ name: 'Loop', assetId: 'a', start: 0, duration: 2, offset: 1, sourceBpm: 60 })]
    const [ev] = clipEvents(p, { from: 0.5, to: 1, catchUp: true })
    expect(ev).toMatchObject({ rate: 2, clipTime: 0.5, assetOffset: 2, duration: 1.5 })
    expect(trimEventStart(ev, 0.25)).toMatchObject({ assetOffset: 2.5, duration: 1.25 })
  })

  it('trim in timeline seconds while the offset moves in audio seconds', () => {
    const c = createClip({ name: 'Loop', assetId: 'a', start: 1, duration: 2, offset: 1, sourceBpm: 60 })
    // Rate 2: the audio before the offset (1 s) covers 0.5 s of timeline.
    expect(trimStart(c, 0, { rate: 2 })).toMatchObject({ start: 0.5, offset: 0, duration: 2.5 })
    // 4 s of audio from offset 1 s leaves 1.5 s of timeline.
    expect(trimEnd(c, 10, { rate: 2, assetDuration: 4 })).toMatchObject({ duration: 1.5 })
  })

  it('need stretching only in Stretch mode, once per asset and rate', () => {
    const p = createProject()
    p.tracks[0].clips = [
      createClip({ name: 'A', assetId: 'a', start: 0, duration: 2, sourceBpm: 60 }),
      createClip({ name: 'A again', assetId: 'a', start: 4, duration: 2, sourceBpm: 60 }),
      createClip({ name: 'B', assetId: 'b', start: 0, duration: 2, sourceBpm: 120 }),
      createClip({ name: 'C', assetId: 'c', start: 0, duration: 2 }),
    ]
    p.tracks[1] = { ...p.tracks[1], kind: 'midi', clips: [createMidiClip({ start: 0, duration: 2 })] }
    expect(neededStretches(p)).toEqual([{ assetId: 'a', rate: 2, reversed: false }])
    expect(neededStretches({ ...p, syncMode: 'resample' })).toEqual([])
  })

  it('load with their tempo and the sync mode', () => {
    setSyncMode('resample')
    const raw = JSON.parse(JSON.stringify(useProjectStore.getState().project))
    raw.tracks[0].clips = [
      { id: 'c1', assetId: 'a', start: 0, duration: 1, sourceBpm: 90 },
      { id: 'c2', assetId: 'a', start: 0, duration: 1, sourceBpm: 5 },
    ]
    const p = normalizeProject(raw)
    expect(p.syncMode).toBe('resample')
    expect((p.tracks[0].clips[0] as AudioClip).sourceBpm).toBe(90)
    expect(p.tracks[0].clips[1]).not.toHaveProperty('sourceBpm')
    expect(normalizeProject({ version: 1, tracks: [] }).syncMode).toBe('stretch')
  })
})

describe('timeStretch', () => {
  const sampleRate = 8000
  const sine = (freq: number, seconds: number) =>
    Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => Math.sin((2 * Math.PI * freq * i) / sampleRate))
  /** Upward zero crossings per second. */
  const frequency = (x: Float32Array) => {
    let crossings = 0
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
    return (crossings * sampleRate) / x.length
  }
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

  it('changes the length by the rate and keeps the pitch and level', () => {
    const input = sine(220, 2)
    for (const rate of [0.5, 0.8, 1.25, 2]) {
      const [out] = timeStretch([input], sampleRate, rate)
      expect(out.length).toBe(Math.round(input.length / rate))
      const body = out.subarray(400, out.length - 400)
      expect(frequency(body)).toBeGreaterThan(215)
      expect(frequency(body)).toBeLessThan(225)
      expect(rms(body)).toBeGreaterThan(0.6)
      expect(rms(body)).toBeLessThan(0.8)
    }
  })

  it('stretches every channel the same way and leaves rate 1 unchanged', () => {
    const left = sine(220, 1)
    const [a, b] = timeStretch([left, left.slice()], sampleRate, 1.5)
    expect(a).toEqual(b)
    expect(timeStretch([left], sampleRate, 1)[0]).toEqual(left)
  })
})
