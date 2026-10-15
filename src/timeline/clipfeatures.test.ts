import { beforeEach, describe, expect, it } from 'vitest'
import { clipEvents, fadeShape, gainEnvelope } from '../audio/schedule'
import { neededStretches } from '../audio/stretch'
import { createClip, createMidiClip, createProject, createTrack } from '../model/factory'
import { normalizeProject, usedAssetIds } from '../model/migrate'
import { clipPlayback } from '../model/tempo'
import type { AudioClip, Project } from '../model/types'
import { applyPitchEdits, placeRendered, setClipsPitch, setClipsReversed } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { isolate, soundEnd } from './bounce'
import { trimEnd, trimStart } from './edits'

const project = () => useProjectStore.getState().project
const firstClip = () => project().tracks[0].clips[0] as AudioClip

function withClip(fields: Partial<AudioClip>, assetDuration = 10): Project {
  const p = createProject()
  p.assets.a = { id: 'a', name: 'A', duration: assetDuration, sampleRate: 44100, channels: 2 }
  p.tracks[0].clips = [createClip({ name: 'c', assetId: 'a', start: 0, duration: 2, ...fields })]
  return p
}

describe('curved fades', () => {
  it('bends the fade shape both ways around a straight line', () => {
    expect(fadeShape(0.5)).toBe(0.5)
    expect(fadeShape(0.5, 1)).toBeGreaterThan(0.8)
    expect(fadeShape(0.5, -1)).toBeLessThan(0.1)
    expect([fadeShape(0, 1), fadeShape(1, -1)]).toEqual([0, 1])
  })

  it('follows a curved fade with extra envelope points', () => {
    const straight = withClip({ fadeIn: 1 }).tracks[0].clips[0] as AudioClip
    const curved = { ...straight, fadeInCurve: 0.8 }
    const ev = (clip: AudioClip) => ({ trackId: 't', clip, at: 0, clipTime: 0, assetOffset: 0, duration: 2, rate: 1, playbackRate: 1, stretch: 1, reversed: false })
    expect(gainEnvelope(ev(straight))).toHaveLength(3)
    const points = gainEnvelope(ev(curved))
    expect(points.length).toBeGreaterThan(10)
    const half = points.find((p) => Math.abs(p.time - 0.5) < 1e-9)!
    expect(half.value).toBeCloseTo(fadeShape(0.5, 0.8))
  })
})

describe('reverse and pitch', () => {
  it('reads a reversed clip from the end of its window', () => {
    const p = withClip({ offset: 1, duration: 2, reversed: true })
    // Window [1, 3] of a 10 s asset, backwards: the reversed asset from 7 s.
    const [ev] = clipEvents(p, { from: 0.5, to: 1, catchUp: true })
    expect(ev).toMatchObject({ reversed: true, assetOffset: 7.5 })
  })

  it('combines pitch and tempo into one stretch and one playback rate', () => {
    const clip = createClip({ name: 'c', assetId: 'a', start: 0, duration: 2, pitch: 12, sourceBpm: 60 })
    // 120 BPM: twice as fast. An octave up: the buffer plays at double speed.
    expect(clipPlayback(clip, 120, 'stretch')).toEqual({ rate: 2, playbackRate: 2, stretch: 1 })
    expect(clipPlayback(clip, 120, 'resample')).toEqual({ rate: 2, playbackRate: 4, stretch: 0.5 })
    expect(clipPlayback({ ...clip, pitch: undefined }, 120, 'stretch')).toEqual({ rate: 2, playbackRate: 1, stretch: 2 })
  })

  it('asks for stretched copies of pitch-shifted clips, forwards and backwards', () => {
    const p = withClip({ pitch: 12 })
    p.tracks[1].clips = [createClip({ name: 'r', assetId: 'a', start: 0, duration: 1, pitch: 12, reversed: true })]
    expect(neededStretches(p)).toEqual([
      { assetId: 'a', rate: 0.5, reversed: false },
      { assetId: 'a', rate: 0.5, reversed: true },
    ])
  })

  it('trims a reversed clip from the other end of its audio', () => {
    const clip = createClip({ name: 'c', assetId: 'a', start: 2, offset: 1, duration: 2, reversed: true })
    const context = { reversed: true, assetDuration: 10 }
    // The left edge shows the window's end: it can reveal up to 7 s more, the offset stays.
    expect(trimStart(clip, 0, context)).toMatchObject({ start: 0, offset: 1, duration: 4 })
    // The right edge shows the window's start: it can reveal the 1 s before it.
    expect(trimEnd(clip, 9, context)).toMatchObject({ duration: 3, offset: 0 })
    expect(trimEnd(clip, 3.5, context)).toMatchObject({ duration: 1.5, offset: 1.5 })
  })
})

describe('clip actions', () => {
  beforeEach(() => useProjectStore.getState().load(withClip({})))

  it('reverses and pitch-shifts audio clips, leaving MIDI clips alone', () => {
    const id = firstClip().id
    setClipsReversed([id], true)
    setClipsPitch([id], 30)
    expect(firstClip()).toMatchObject({ reversed: true, pitch: 24 })
    setClipsReversed([id], false)
    setClipsPitch([id], 0)
    expect(firstClip()).not.toHaveProperty('reversed')
    expect(firstClip()).not.toHaveProperty('pitch')
  })

  it('places rendered audio in place of clips, or on a new track below with the source muted', () => {
    const asset = { id: 'ast_r', name: 'Render', duration: 3, sampleRate: 44100, channels: 2 }
    const source = project().tracks[0]
    placeRendered(asset, 1, [firstClip().id], { trackId: source.id }, 'Bounce')
    expect(project().tracks[0].clips.map((c) => (c as AudioClip).assetId)).toEqual(['ast_r'])
    const id = placeRendered(asset, 0, [], { below: source.id, name: 'Synth (audio)', muteSource: true }, 'Convert')
    expect(project().tracks[1]).toMatchObject({ id, name: 'Synth (audio)' })
    expect(project().tracks[0].muted).toBe(true)
    useProjectStore.getState().undo()
    expect(project().tracks[0].muted).toBe(false)
  })

  it('saves and loads reverse, pitch and fade curves', () => {
    const p = withClip({ reversed: true, pitch: -3.5, fadeInCurve: 0.4, fadeOutCurve: 7 })
    const loaded = normalizeProject(JSON.parse(JSON.stringify(p))).tracks[0].clips[0]
    expect(loaded).toMatchObject({ reversed: true, pitch: -3.5, fadeInCurve: 0.4, fadeOutCurve: 1 })
  })
})

describe('rendering helpers', () => {
  it('isolates a track dry or with its effects', () => {
    const p = createProject()
    const synth = createTrack('Synth', 'midi')
    synth.clips = [createMidiClip({ start: 0, duration: 2 }), createMidiClip({ start: 4, duration: 2 })]
    synth.volume = 0.5
    synth.effects = [{ id: 'fx', type: 'eq', enabled: true, params: {} }]
    p.tracks.push(synth)
    p.master.effects = [{ id: 'm', type: 'compressor', enabled: true, params: {} }]
    const dry = isolate(p, synth.id, [synth.clips[0].id], false)
    expect(dry.tracks).toHaveLength(1)
    expect(dry.tracks[0]).toMatchObject({ volume: 1, effects: [], clips: [synth.clips[0]] })
    expect(dry.master.effects).toEqual([])
    expect(isolate(p, synth.id, [synth.clips[0].id], true).tracks[0].effects).toHaveLength(1)
  })

  it('finds where the sound ends', () => {
    const c = new Float32Array(1000)
    c[400] = 0.5
    c[900] = 1e-6
    expect(soundEnd([c, new Float32Array(1000)])).toBe(401)
  })
})

describe('pitch editor edits', () => {
  beforeEach(() => useProjectStore.getState().load(withClip({})))

  it('switches the clip to the tuned audio, keeping the original and the moves', () => {
    const id = firstClip().id
    const tuned = { id: 'ast_tuned', name: 'A (tuned)', duration: 10, sampleRate: 44100, channels: 2 }
    const edits = [{ start: 1, end: 1.5, shift: 2 }]
    applyPitchEdits(id, 'a', edits, tuned)
    expect(firstClip()).toMatchObject({ assetId: 'ast_tuned', pitchSource: { assetId: 'a', edits } })
    // Both the tuned and the original audio are saved with the project.
    expect(usedAssetIds(project()).sort()).toEqual(['a', 'ast_tuned'])
    const loaded = normalizeProject(JSON.parse(JSON.stringify(project()))).tracks[0].clips[0]
    expect(loaded).toMatchObject({ pitchSource: { assetId: 'a', edits } })
    // No moves left: back to the original.
    applyPitchEdits(id, 'a', [], null)
    expect(firstClip().assetId).toBe('a')
    expect(firstClip()).not.toHaveProperty('pitchSource')
    useProjectStore.getState().undo()
    expect(firstClip().assetId).toBe('ast_tuned')
  })

  it('drops broken pitch edits when loading', () => {
    const p = withClip({ pitchSource: { assetId: 'a', edits: [{ start: 2, end: 1, shift: 1 }, { start: 0, end: 1, shift: 99 }] } })
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).tracks[0].clips[0]).toMatchObject({
      pitchSource: { assetId: 'a', edits: [{ start: 0, end: 1, shift: 24 }] },
    })
  })
})
