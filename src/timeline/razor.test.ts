import { beforeEach, describe, expect, it } from 'vitest'
import { pickLibraryKit } from '../drums/libraryKit'
import type { SampleInfo } from '../library/repo'
import { createClip, createMidiClip, createProject } from '../model/factory'
import { clipRate } from '../model/tempo'
import type { AudioClip, MidiClip, Project } from '../model/types'
import { replaceClipAudio, splitClips } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { toggleMagnet } from '../ui/useShortcuts'
import { splitClip, stretchEnd } from './edits'

const project = () => useProjectStore.getState().project

describe('razor', () => {
  it('cuts an audio clip so both halves play on as before', () => {
    const clip = createClip({ name: 'c', assetId: 'a', start: 2, offset: 1, duration: 4, fadeIn: 0.5, fadeOut: 0.5 })
    const [left, right] = splitClip(clip, 3)!
    expect(left).toMatchObject({ duration: 1, fadeIn: 0.5, fadeOut: 0 })
    expect(right).toMatchObject({ start: 3, duration: 3, offset: 2, fadeIn: 0, fadeOut: 0.5 })
    expect(splitClip(clip, 2)).toBeNull()
    expect(splitClip(clip, 7)).toBeNull()
  })

  it('cuts reversed and synced clips from the right end of their audio', () => {
    const clip = createClip({ name: 'c', assetId: 'a', start: 0, offset: 1, duration: 4, reversed: true })
    // Backwards: the left part plays the window's end, the right part its start.
    const [left, right] = splitClip(clip, 1, { reversed: true })!
    expect(left.offset).toBe(4)
    expect(right.offset).toBe(1)
    const synced = createClip({ name: 's', assetId: 'a', start: 0, duration: 4, sourceBpm: 60 })
    expect(splitClip(synced, 1, { rate: clipRate(synced, 120) })![1].offset).toBe(2)
  })

  it('gives each half of a MIDI clip the notes that start in it', () => {
    const clip = createMidiClip({
      start: 0,
      duration: 4,
      notes: [
        { id: 'n1', pitch: 60, start: 0, length: 1, velocity: 1 },
        { id: 'n2', pitch: 62, start: 4, length: 1, velocity: 1 },
      ],
    })
    // 120 BPM: the cut at 1 s is beat 2.
    const [left, right] = splitClip(clip, 1, {}, 120)!
    expect((left as Partial<MidiClip>).notes!.map((n) => n.id)).toEqual(['n1'])
    expect((right as MidiClip).notes.map((n) => n.id)).toEqual(['n2'])
  })

  it('splits as one undo step and gives the new part fresh ids', () => {
    const p = createProject()
    p.tracks[0].clips = [createClip({ name: 'c', assetId: 'a', start: 0, duration: 4 })]
    useProjectStore.getState().load(p)
    const [id] = splitClips([p.tracks[0].clips[0].id], 1.5)
    expect(project().tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 1.5],
      [1.5, 2.5],
    ])
    expect(id).not.toBe(p.tracks[0].clips[0].id)
    useProjectStore.getState().undo()
    expect(project().tracks[0].clips).toHaveLength(1)
  })
})

describe('stretching and replacing audio', () => {
  it('stretches the same audio over the new length by syncing it', () => {
    const clip = createClip({ name: 'c', assetId: 'a', start: 0, duration: 2, fadeOut: 0.2 })
    const fields = stretchEnd(clip, 4, 120)!
    // Twice as long: the audio plays at half speed, as if it was made at 240 BPM.
    expect(fields).toMatchObject({ duration: 4, sourceBpm: 240, fadeOut: 0.4 })
    expect(clipRate({ ...clip, ...fields } as AudioClip, 120) * 4).toBeCloseTo(2)
    // Kept within the tempos a synced clip can have.
    expect((stretchEnd(clip, 100, 120) as Partial<AudioClip>).sourceBpm).toBeLessThanOrEqual(300)
    expect(stretchEnd(createMidiClip({ start: 0, duration: 1 }), 2, 120)).toBeNull()
  })

  it('swaps the audio a clip plays, keeping its place', () => {
    const p: Project = createProject()
    p.assets.a = { id: 'a', name: 'A', duration: 10, sampleRate: 44100, channels: 2 }
    p.tracks[0].clips = [createClip({ name: 'A', assetId: 'a', start: 3, offset: 2, duration: 5, fadeOut: 1 })]
    useProjectStore.getState().load(p)
    replaceClipAudio(p.tracks[0].clips[0].id, { id: 'b', name: 'B', duration: 2, sampleRate: 44100, channels: 2 })
    expect(project().tracks[0].clips[0]).toMatchObject({ assetId: 'b', name: 'B', start: 3, offset: 0, duration: 2, fadeOut: 1 })
  })
})

describe('magnet', () => {
  beforeEach(() => useProjectStore.getState().load(createProject()))

  it('turns snapping off and back to what it was', () => {
    useProjectStore.getState().update('snap', (p) => void (p.snap = 'bar'))
    toggleMagnet()
    expect(project().snap).toBe('off')
    toggleMagnet()
    expect(project().snap).toBe('bar')
  })
})

describe('kit from library', () => {
  const sample = (id: string, path: string, category: SampleInfo['category'], duration = 0.5): SampleInfo => ({
    id,
    libraryId: 'lib',
    path,
    name: path,
    type: 'audio/wav',
    size: 1,
    category,
    bpm: null,
    signature: null,
    duration,
  })

  it('puts a matching one-shot on each pad it can fill', () => {
    const samples = [
      sample('k', 'Kicks/kick 1.wav', 'kick'),
      sample('s', 'Snares/snare 1.wav', 'snare'),
      sample('hc', 'Hats/hat closed.wav', 'hihat'),
      sample('ho', 'Hats/open hat.wav', 'hihat'),
      sample('loop', 'Loops/kick loop 95 bpm.wav', 'kick', 8),
    ]
    const picks = pickLibraryKit(samples, () => 0)
    expect(Object.fromEntries(picks)).toEqual({ 36: 'k', 38: 's', 42: 'hc', 46: 'ho' })
    expect(pickLibraryKit([], () => 0).size).toBe(0)
  })
})
