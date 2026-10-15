import { beforeEach, describe, expect, it } from 'vitest'
import { noteEvents } from '../audio/schedule'
import { createMidiClip, createProject, createTrack } from '../model/factory'
import { swingDelay } from '../model/midi'
import { normalizeProject } from '../model/migrate'
import type { MidiClip } from '../model/types'
import { applyPattern, setClipSwing } from '../state/actions'
import { useProjectStore } from '../state/projectStore'

const project = () => useProjectStore.getState().project
const drumClip = () => project().tracks[0].clips[0] as MidiClip

beforeEach(() => {
  const p = createProject()
  const drums = createTrack('Drums', 'drums')
  drums.clips = [
    createMidiClip({
      start: 0,
      duration: 2,
      notes: [
        { id: 'a', pitch: 36, start: 0, length: 0.25, velocity: 1 },
        { id: 'b', pitch: 42, start: 0.25, length: 0.25, velocity: 1 },
        { id: 'c', pitch: 42, start: 0.5, length: 0.25, velocity: 1 },
      ],
    }),
  ]
  p.tracks = [drums]
  useProjectStore.getState().load(p)
})

describe('swing', () => {
  it('delays only the second sixteenth of each eighth, up to a triplet at 100%', () => {
    expect(swingDelay(0.25, 100)).toBeCloseTo(1 / 12)
    expect(swingDelay(1.75, 50)).toBeCloseTo(1 / 24)
    expect(swingDelay(0.5, 100)).toBe(0)
    expect(swingDelay(0.125, 100)).toBe(0)
    expect(swingDelay(0.25, 0)).toBe(0)
  })

  it('plays swung notes later without moving them in the clip', () => {
    setClipSwing(drumClip().id, 100)
    // 120 BPM: a beat is 0.5 s, so the second sixteenth moves from 0.125 s by 1/12 beat.
    const at = noteEvents(project(), { from: 0, to: 2, catchUp: false }).map((e) => +e.at.toFixed(4))
    expect(at).toEqual([0, +(0.125 + 0.5 / 12).toFixed(4), 0.25])
    expect(drumClip().notes[1].start).toBe(0.25)
  })

  it('saves and loads the swing, dropping it when straight', () => {
    setClipSwing(drumClip().id, 140)
    expect(drumClip().swing).toBe(100)
    const loaded = normalizeProject(JSON.parse(JSON.stringify(project())))
    expect((loaded.tracks[0].clips[0] as MidiClip).swing).toBe(100)
    setClipSwing(drumClip().id, 0)
    expect(drumClip()).not.toHaveProperty('swing')
  })

  it('gives generated drums and parts the genre swing', () => {
    applyPattern(drumClip().id, [], [{ track: 'Keys', instrument: 'keys', notes: [] }], 'Generate', 45)
    expect(drumClip().swing).toBe(45)
    expect((project().tracks.find((t) => t.name === 'Keys')!.clips[0] as MidiClip).swing).toBe(45)
    applyPattern(drumClip().id, [], [], 'Generate', 0)
    expect(drumClip()).not.toHaveProperty('swing')
  })
})
