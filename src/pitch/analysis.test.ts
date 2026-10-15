import { describe, expect, it } from 'vitest'
import { analysePitch, pitchAt, renderPitchEdits, segmentNotes, shiftAt } from './analysis'

const sr = 44100
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** A voice singing notes [midi, seconds] back to back, with short silent gaps. */
function sing(notes: [number, number][], gap = 0.05): Float32Array {
  const total = notes.reduce((s, [, d]) => s + d + gap, 0)
  const out = new Float32Array(Math.round(total * sr))
  let at = 0
  for (const [midi, seconds] of notes) {
    const n = Math.round(seconds * sr)
    let phase = 0
    for (let i = 0; i < n; i++) {
      phase += hz(midi) / sr
      let v = 0
      for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * phase * h) / h
      // Short fades so each note starts and ends cleanly.
      const env = Math.min(1, i / 400, (n - i) / 400)
      out[at + i] = 0.3 * v * env
    }
    at += n + Math.round(gap * sr)
  }
  return out
}

describe('pitch analysis', () => {
  const voice = sing([
    [57, 0.5],
    [60, 0.4],
    [64.3, 0.5],
  ])
  const track = analysePitch([voice], sr)

  it('follows the sung pitch', () => {
    expect(pitchAt(track, 0.25)).toBeCloseTo(57, 1)
    expect(pitchAt(track, 0.75)).toBeCloseTo(60, 1)
    expect(pitchAt(track, 1.25)).toBeCloseTo(64.3, 1)
    // In the gap between notes there is no pitch.
    expect(pitchAt(track, 0.525)).toBeNull()
  })

  it('groups the frames into notes', () => {
    const notes = segmentNotes(track)
    expect(notes.map((n) => +n.midi.toFixed(1))).toEqual([57, 60, 64.3])
    expect(notes[0].start).toBeCloseTo(0, 1)
    expect(notes[1].start).toBeCloseTo(0.55, 1)
    expect(notes[2].end).toBeCloseTo(1.5, 1)
  })

  it('ramps shifts in and out at segment edges', () => {
    const segments = [{ start: 1, end: 2, shift: 2 }]
    expect(shiftAt(segments, 1.5)).toBe(2)
    expect(shiftAt(segments, 0.5)).toBe(0)
    expect(shiftAt(segments, 0.9925)).toBeCloseTo(1, 1)
  })

  it('moves one note and leaves the rest, keeping length and timing', () => {
    const notes = segmentNotes(track)
    const edited = renderPitchEdits([voice], sr, track, [{ start: notes[1].start, end: notes[1].end, shift: 2 }])[0]
    expect(edited.length).toBe(voice.length)
    const after = segmentNotes(analysePitch([edited], sr))
    expect(after.map((n) => +n.midi.toFixed(1))).toEqual([57, 62, 64.3])
    // Still in time (within a couple of frames).
    after.forEach((n, i) => expect(Math.abs(n.start - notes[i].start)).toBeLessThan(0.02))
  })
})
