import { beforeEach, describe, expect, it } from 'vitest'
import { drumLength } from '../audio/drums'
import { noteEvents } from '../audio/schedule'
import { createMidiClip, createProject, createTrack } from '../model/factory'
import { createNote } from '../model/midi'
import { normalizeProject, usedAssetIds } from '../model/migrate'
import type { MidiClip } from '../model/types'
import { addMidiClip, addTrack, applyKitPreset, applyPattern, setPad, setPadSample } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { moveClips } from '../timeline/edits'
import { GENRES, generatePattern, random, type GenreId } from './generator'
import { KIT_PRESETS, NOTE, PADS, createKit } from './kits'

const project = () => useProjectStore.getState().project
const drumTrack = () => project().tracks.find((t) => t.kind === 'drums')!
const asset = (id: string) => ({ id, name: 'Snap', duration: 0.3, sampleRate: 44100, channels: 1 })

beforeEach(() => {
  const p = createProject()
  p.tracks = [createTrack('Drums', 'drums')]
  useProjectStore.getState().load(p)
})

describe('kits', () => {
  it('has 16 pads on distinct General MIDI notes', () => {
    expect(PADS).toHaveLength(16)
    expect(new Set(PADS.map((p) => p.note)).size).toBe(16)
  })

  it('builds kits from presets, all on the same pads', () => {
    for (const preset of KIT_PRESETS) {
      const kit = createKit(preset.id)
      expect(kit.preset).toBe(preset.id)
      expect(kit.pads.map((p) => p.note)).toEqual(PADS.map((p) => p.note))
    }
    expect(createKit('trap').pads.find((p) => p.note === NOTE.sub)!.decay).toBe(2.5)
    expect(createKit('nope').preset).toBe('standard')
  })

  it('scales the length of synthesized sounds with the decay', () => {
    expect(drumLength({ voice: 'crash', decay: 2 })).toBeCloseTo(3.2)
    expect(drumLength({ voice: 'shaker', decay: 1 })).toBeCloseTo(0.102)
  })
})

describe('drum tracks', () => {
  it('get a standard kit and no record button', () => {
    const id = addTrack(undefined, 'drums')
    const t = project().tracks.find((x) => x.id === id)!
    expect(t.name).toBe('Drums 2')
    expect(t.kit!.preset).toBe('standard')
    expect(t.instrument).toBeUndefined()
  })

  it('change pads within their ranges, and become a custom kit', () => {
    const t = drumTrack().id
    setPad(t, NOTE.kick, { tune: 30, decay: 0.1, gain: 1.5 })
    expect(drumTrack().kit!.pads.find((p) => p.note === NOTE.kick)).toMatchObject({ tune: 12, decay: 0.25, gain: 1.5 })
    expect(drumTrack().kit!.preset).toBe('custom')
  })

  it('take samples on pads, saved with the project, and drop them with a preset', () => {
    const t = drumTrack().id
    setPadSample(t, NOTE.snare, asset('ast_snap'))
    expect(drumTrack().kit!.pads.find((p) => p.note === NOTE.snare)!.sample).toEqual({ assetId: 'ast_snap' })
    expect(usedAssetIds(project())).toEqual(['ast_snap'])
    applyKitPreset(t, 'lofi')
    expect(drumTrack().kit!.preset).toBe('lofi')
    expect(usedAssetIds(project())).toEqual([])
    useProjectStore.getState().undo()
    expect(usedAssetIds(project())).toEqual(['ast_snap'])
  })

  it('play their hits as note events', () => {
    const id = addMidiClip(drumTrack().id, 0)!
    const clip = drumTrack().clips[0] as MidiClip
    expect(clip.id).toBe(id)
    const p = structuredClone(project())
    ;(p.tracks[0].clips[0] as MidiClip).notes = [createNote({ pitch: NOTE.kick, start: 0, length: 0.25 }), createNote({ pitch: NOTE.snare, start: 1, length: 0.25 })]
    expect(noteEvents(p, { from: 0, to: 4, catchUp: true }).map((e) => [e.pitch, e.at])).toEqual([
      [NOTE.kick, 0],
      [NOTE.snare, 0.5],
    ])
  })

  it('only trade clips with other drum tracks', () => {
    const p = createProject()
    p.tracks = [createTrack('Drums', 'drums'), createTrack('Keys', 'midi'), createTrack('More drums', 'drums')]
    const clip = createMidiClip({ start: 0, duration: 2 })
    const ids = p.tracks.map((t) => t.id)
    const kinds = p.tracks.map((t) => t.kind)
    expect(moveClips([{ clip, trackIndex: 0 }], clip, 0, 1, ids, (t) => t, kinds)[clip.id].trackId).toBe(ids[0])
    expect(moveClips([{ clip, trackIndex: 0 }], clip, 0, 2, ids, (t) => t, kinds)[clip.id].trackId).toBe(ids[2])
  })

  it('load with their kit repaired', () => {
    const p = normalizeProject({
      version: 1,
      tracks: [
        {
          id: 't1',
          kind: 'drums',
          kit: {
            preset: 'trap',
            pads: [
              { note: 36, name: 'Kick', voice: 'kick', tune: 40, decay: 1, gain: 1, sample: { assetId: 'a1' } },
              { note: 36, name: 'Again' },
              { note: 300 },
              { note: 38, voice: 'kazoo' },
            ],
          },
          clips: [{ id: 'c1', start: 0, duration: 2, notes: [{ id: 'n1', pitch: 36, start: 0, length: 0.25 }] }],
        },
        { id: 't2', kind: 'drums' },
      ],
    })
    expect(p.tracks[0].kit).toEqual({
      preset: 'trap',
      pads: [
        { note: 36, name: 'Kick', voice: 'kick', tune: 12, decay: 1, gain: 1, sample: { assetId: 'a1' } },
        { note: 38, name: 'Snare', voice: 'snare', tune: 0, decay: 1, gain: 1 },
      ],
    })
    expect(p.tracks[0].clips).toHaveLength(1)
    expect(p.tracks[1].kit).toEqual(createKit())
    expect(usedAssetIds(p)).toEqual(['a1'])
  })
})

describe('applyPattern', () => {
  it('writes drums into the clip and parts onto named MIDI tracks, as one undo step', () => {
    const id = addMidiClip(drumTrack().id, 2)!
    const part = (pitch: number) => [createNote({ pitch, start: 0, length: 1 })]
    applyPattern(id, part(NOTE.kick), [
      { track: 'Chords', instrument: 'pad', notes: part(60) },
      { track: 'Bass', instrument: 'bass', notes: part(36) },
    ])
    expect(project().tracks.map((t) => t.name)).toEqual(['Drums', 'Chords', 'Bass'])
    expect((drumTrack().clips[0] as MidiClip).notes.map((n) => n.pitch)).toEqual([NOTE.kick])
    const chords = project().tracks[1]
    expect(chords.instrument!.type).toBe('pad')
    expect(chords.clips[0]).toMatchObject({ start: 2, duration: 2 })

    // Generating again replaces the part's clip under the drum clip instead of stacking.
    applyPattern(id, null, [{ track: 'Chords', instrument: 'pad', notes: part(62) }])
    expect(project().tracks).toHaveLength(3)
    expect(project().tracks[1].clips.map((c) => (c as MidiClip).notes[0].pitch)).toEqual([62])
    expect((drumTrack().clips[0] as MidiClip).notes.map((n) => n.pitch)).toEqual([NOTE.kick])

    useProjectStore.getState().undo()
    useProjectStore.getState().undo()
    expect(project().tracks.map((t) => t.name)).toEqual(['Drums'])
  })
})

describe('generatePattern', () => {
  const opts = { genre: 'reggaeton' as GenreId, key: 9, scale: 'minor' as const, seed: 42 }

  it('is repeatable for a seed and varies between seeds', () => {
    expect(generatePattern(opts, 2)).toEqual(generatePattern(opts, 2))
    const a = JSON.stringify(generatePattern(opts, 4))
    const b = JSON.stringify(generatePattern({ ...opts, seed: 43 }, 4))
    expect(a).not.toBe(b)
  })

  it('keeps every genre inside the bars, on the kit pads and in the key', () => {
    const pads = new Set(PADS.map((p) => p.note))
    for (const genre of Object.keys(GENRES) as GenreId[]) {
      for (const scale of ['major', 'minor'] as const) {
        const g = generatePattern({ genre, key: 2, scale, seed: 7 }, 2)
        const all = [...g.drums, ...g.chords, ...g.melody, ...g.bass]
        expect(all.every((n) => n.start >= 0 && n.start < 8 && n.length > 0 && n.velocity > 0 && n.velocity <= 1)).toBe(true)
        expect(g.drums.every((n) => pads.has(n.pitch))).toBe(true)
        expect(g.drums.some((n) => n.pitch === NOTE.kick)).toBe(true)
        // D major / D minor pitch classes.
        const inKey = new Set((scale === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).map((i) => (i + 2) % 12))
        for (const n of [...g.chords, ...g.melody, ...g.bass]) expect(inKey.has(n.pitch % 12)).toBe(true)
        expect(g.bass.every((n) => n.pitch >= 24 && n.pitch <= 47)).toBe(true)
        expect(g.chords.length).toBeGreaterThan(0)
      }
    }
  })

  it('follows the minor or major third of the key on the first chord', () => {
    const first = (scale: 'major' | 'minor') =>
      generatePattern({ ...opts, genre: 'ballad', key: 0, scale }, 1)
        .chords.filter((n) => n.start === 0)
        .map((n) => n.pitch % 12)
        .sort((x, y) => x - y)
    expect(first('major')).toEqual([0, 4, 7])
    expect(first('minor')).toEqual([0, 3, 7])
  })

  it('fits shorter bars (3/4: 12 steps)', () => {
    const g = generatePattern(opts, 2, 12)
    expect([...g.drums, ...g.melody].every((n) => n.start < 6)).toBe(true)
  })

  it('gives seeded random numbers between 0 and 1', () => {
    const r = random(1)
    const xs = Array.from({ length: 1000 }, r)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThan(1)
  })
})
