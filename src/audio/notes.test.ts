import { describe, expect, it } from 'vitest'
import { createClip, createMidiClip, createProject, createTrack } from '../model/factory'
import { createNote } from '../model/midi'
import type { MidiClip, Project } from '../model/types'
import { envelopeLevel } from './instruments'
import { clipEvents, noteEvents, patternProject } from './schedule'

// At 120 BPM a beat (quarter note) lasts 0.5 s.
function projectWith(clip: Partial<MidiClip>, glide = 0): Project {
  const p = createProject()
  const track = createTrack('Synth', 'midi')
  track.instrument!.glide = glide
  track.clips = [createMidiClip({ start: 0, duration: 4, ...clip })]
  p.tracks = [track]
  return p
}

const n = (pitch: number, start: number, length = 1, velocity = 1) => createNote({ pitch, start, length, velocity })

describe('noteEvents', () => {
  it('turns beats into timeline seconds', () => {
    const p = projectWith({ start: 1, notes: [n(60, 0), n(64, 2, 0.5)] })
    const events = noteEvents(p, { from: 0, to: 10, catchUp: false })
    expect(events.map((e) => [e.pitch, e.at, e.duration])).toEqual([
      [60, 1, 0.5],
      [64, 2, 0.25],
    ])
  })

  it('never schedules a note twice across adjacent windows', () => {
    const p = projectWith({ notes: [n(60, 2)] })
    const a = noteEvents(p, { from: 0, to: 1, catchUp: true })
    const b = noteEvents(p, { from: 1, to: 2, catchUp: false })
    expect(a.length + b.length).toBe(1)
  })

  it('joins held notes only when catching up', () => {
    const p = projectWith({ notes: [n(60, 0, 4)] })
    expect(noteEvents(p, { from: 1, to: 1.5, catchUp: false })).toHaveLength(0)
    const [ev] = noteEvents(p, { from: 1, to: 1.5, catchUp: true })
    expect(ev).toMatchObject({ at: 1, duration: 1 })
  })

  it('cuts notes at the clip edges and at cutAt, and skips notes outside the clip', () => {
    // Content starts at -1 s (offset 1 s) and the clip ends at 1.5 s: the note at beat 0 is
    // trimmed off, the one at beat 1.5 is cut at the clip start, the one at beat 4 at its end.
    const p = projectWith({ start: 0, offset: 1, duration: 1.5, notes: [n(48, 0), n(50, 1.5, 2), n(52, 4), n(53, 6)] })
    const events = noteEvents(p, { from: 0, to: 10, catchUp: true })
    expect(events.map((e) => [e.pitch, e.at, e.duration])).toEqual([
      [50, 0, 0.75],
      [52, 1, 0.5],
    ])
    expect(noteEvents(p, { from: 0, to: 10, catchUp: true, cutAt: 0.5 })[0].duration).toBe(0.5)
  })

  it('scales velocity by the clip gain and fade', () => {
    const p = projectWith({ gain: 0.5, fadeIn: 1, notes: [n(60, 0), n(62, 1, 1, 0.8), n(64, 4)] })
    expect(noteEvents(p, { from: 0, to: 10, catchUp: false }).map((e) => e.velocity)).toEqual([0, 0.2, 0.5])
  })

  it('plays one note at a time with glide, sliding from overlapping notes', () => {
    const p = projectWith({ notes: [n(60, 0, 2), n(67, 1, 1), n(72, 3, 1)] }, 0.1)
    const events = noteEvents(p, { from: 0, to: 10, catchUp: false })
    expect(events.map((e) => [e.pitch, e.duration, e.glideFrom])).toEqual([
      [60, 0.5, null],
      [67, 0.5, 60],
      [72, 0.5, null],
    ])
  })

  it('ignores MIDI clips on audio tracks and audio clips in note scheduling', () => {
    const p = projectWith({ notes: [n(60, 0)] })
    p.tracks.push({ ...createTrack('Audio'), clips: [createClip({ name: 'a', assetId: 'x', start: 0, duration: 1 })] })
    expect(noteEvents(p, { from: 0, to: 10, catchUp: true })).toHaveLength(1)
    expect(clipEvents(p, { from: 0, to: 10, catchUp: true })).toHaveLength(1)
  })
})

describe('patternProject', () => {
  it('keeps only the clip, looping over it', () => {
    const p = projectWith({ start: 2, duration: 2 })
    p.tracks.push({ ...createTrack('Audio'), clips: [createClip({ name: 'a', assetId: 'x', start: 0, duration: 1 })] })
    const clipId = p.tracks[0].clips[0].id
    const pattern = patternProject(p, clipId)!
    expect(pattern.loop).toEqual({ enabled: true, start: 2, end: 4 })
    expect(pattern.tracks.map((t) => t.clips.length)).toEqual([1, 0])
    expect(patternProject(p, 'gone')).toBeNull()
  })
})

describe('envelopeLevel', () => {
  it('rises during the attack, then decays to the sustain level', () => {
    const env = { attack: 0.1, decay: 0.3, sustain: 0.5, release: 0.2 }
    expect(envelopeLevel(env, 0)).toBe(0)
    expect(envelopeLevel(env, 0.05)).toBeCloseTo(0.5)
    expect(envelopeLevel(env, 0.1)).toBeCloseTo(1)
    expect(envelopeLevel(env, 5)).toBeCloseTo(0.5)
    expect(envelopeLevel({ ...env, decay: 0 }, 1)).toBe(0.5)
  })
})
