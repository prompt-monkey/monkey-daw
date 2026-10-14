import { beforeEach, describe, expect, it } from 'vitest'
import { createClip, createMidiClip, createProject, createTrack } from '../model/factory'
import { createNote } from '../model/midi'
import { normalizeProject, usedAssetIds } from '../model/migrate'
import { isMidiClip, type MidiClip } from '../model/types'
import { moveClips } from '../timeline/edits'
import {
  addMidiClip,
  addMidiTracks,
  addTrack,
  pasteClips,
  renameClip,
  setBpm,
  setClipNotes,
  setInstrument,
  setSamplerSample,
} from './actions'
import { useProjectStore } from './projectStore'

const project = () => useProjectStore.getState().project
const midiClip = (trackIndex: number) => project().tracks[trackIndex].clips[0] as MidiClip

beforeEach(() => {
  const p = createProject()
  p.tracks = [createTrack('Audio'), createTrack('Synth', 'midi')]
  p.tracks[0].clips = [createClip({ name: 'a', assetId: 'x', start: 1, duration: 2 })]
  useProjectStore.getState().load(p)
})

describe('MIDI tracks and clips', () => {
  it('adds MIDI tracks with an instrument', () => {
    const id = addTrack(0, 'midi')
    const t = project().tracks[0]
    expect(t).toMatchObject({ id, kind: 'midi', instrument: { type: 'keys', glide: 0 } })
    expect(project().tracks[1].instrument).toBeUndefined()
  })

  it('adds a one-bar MIDI clip, only on MIDI tracks', () => {
    const synth = project().tracks[1].id
    expect(addMidiClip(project().tracks[0].id, 0)).toBeNull()
    const id = addMidiClip(synth, 2)!
    // 4/4 at 120 BPM: a bar lasts 2 s.
    expect(midiClip(1)).toMatchObject({ id, start: 2, duration: 2, notes: [], name: 'Synth' })
  })

  it('sorts notes and grows the clip to the next bar line when notes reach past its end', () => {
    const id = addMidiClip(project().tracks[1].id, 0)!
    setClipNotes(id, [createNote({ pitch: 64, start: 2, length: 1 }), createNote({ pitch: 60, start: 0, length: 1 })], 'Add notes')
    expect(midiClip(1).notes.map((n) => n.pitch)).toEqual([60, 64])
    expect(midiClip(1).duration).toBe(2)
    setClipNotes(id, [...midiClip(1).notes, createNote({ pitch: 67, start: 4.5, length: 1 })], 'Add note')
    expect(midiClip(1).duration).toBe(4)
    useProjectStore.getState().undo()
    expect(midiClip(1).duration).toBe(2)
  })

  it('keeps MIDI clips on the bar grid when the tempo changes; audio clips stay put', () => {
    const id = addMidiClip(project().tracks[1].id, 2)!
    setClipNotes(id, [createNote({ pitch: 60, start: 0, length: 1 })], 'Add note')
    setBpm(60)
    expect(midiClip(1)).toMatchObject({ start: 4, duration: 4 })
    expect(midiClip(1).notes[0].start).toBe(0)
    expect(project().tracks[0].clips[0]).toMatchObject({ start: 1, duration: 2 })
  })

  it('pastes clips only onto tracks of their kind', () => {
    const id = addMidiClip(project().tracks[1].id, 0)!
    const clip = midiClip(1)
    const [pasted] = pasteClips([{ clip, trackId: project().tracks[0].id }], 6)
    expect(project().tracks[0].clips.some((c) => c.id === pasted)).toBe(false)
    expect(project().tracks[1].clips.map((c) => c.id)).toEqual([id, pasted])
  })

  it('moves clips across tracks only when every clip fits its new track', () => {
    const p = project()
    const audio = p.tracks[0].clips[0]
    const preview = moveClips([{ clip: audio, trackIndex: 0 }], audio, 0, 1, p.tracks.map((t) => t.id), (t) => t, p.tracks.map((t) => t.kind))
    expect(preview[audio.id].trackId).toBe(p.tracks[0].id)
  })

  it('changes the instrument, falling back from a sampler without a sample', () => {
    const synth = project().tracks[1].id
    setInstrument(synth, { type: 'sampler' })
    expect(project().tracks[1].instrument!.type).toBe('keys')
    setSamplerSample(synth, { id: 'ast_s', name: 'Pluck', duration: 1, sampleRate: 44100, channels: 1 }, 57)
    expect(project().tracks[1].instrument).toMatchObject({ type: 'sampler', sample: { assetId: 'ast_s', root: 57 } })
    expect(usedAssetIds(project())).toContain('ast_s')
  })

  it('imports MIDI parts as tracks with one bar-rounded clip each', () => {
    const [id] = addMidiTracks([{ name: 'Lead', notes: [createNote({ pitch: 72, start: 0, length: 5 })] }], 1)
    const t = project().tracks.find((x) => x.id === id)!
    expect(t).toMatchObject({ name: 'Lead', kind: 'midi' })
    expect(t.clips[0]).toMatchObject({ start: 1, duration: 4 })
  })

  it('renames clips', () => {
    const id = addMidiClip(project().tracks[1].id, 0)!
    renameClip(id, '  Hook ')
    expect(midiClip(1).name).toBe('Hook')
    renameClip(id, '  ')
    expect(midiClip(1).name).toBe('Hook')
  })
})

describe('loading MIDI data', () => {
  it('keeps MIDI clips and repairs notes and instruments', () => {
    const raw = {
      version: 1,
      tracks: [
        {
          id: 't1',
          kind: 'midi',
          instrument: { type: 'sampler', glide: 9 },
          clips: [
            {
              id: 'c1',
              start: 0,
              duration: 2,
              notes: [
                { id: 'n2', pitch: 200, start: 1, length: 0, velocity: 3 },
                { id: 'n1', pitch: 60, start: 0, length: 1 },
                { pitch: 61 },
              ],
            },
            { id: 'c2', assetId: 'x', start: 0, duration: 1 },
          ],
        },
        { id: 't2', clips: [createMidiClip({ start: 0, duration: 1 })] },
      ],
    }
    const p = normalizeProject(raw)
    const [synth, audio] = p.tracks
    expect(synth.instrument).toEqual({ type: 'keys', glide: 1 })
    expect(synth.clips).toHaveLength(1)
    const clip = synth.clips[0]
    expect(isMidiClip(clip) && clip.notes).toEqual([
      { id: 'n1', pitch: 60, start: 0, length: 1, velocity: 0.8 },
      { id: 'n2', pitch: 127, start: 1, length: 1 / 16, velocity: 1 },
    ])
    // A MIDI clip can't live on an audio track.
    expect(audio.clips).toEqual([])
    expect(audio.instrument).toBeUndefined()
  })

  it('round-trips a project with MIDI tracks', () => {
    addMidiClip(project().tracks[1].id, 0)
    expect(normalizeProject(JSON.parse(JSON.stringify(project())))).toEqual(project())
  })
})
