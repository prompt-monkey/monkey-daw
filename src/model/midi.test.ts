import { describe, expect, it } from 'vitest'
import {
  MIN_NOTE_LENGTH,
  clipBeatRange,
  createNote,
  isBlackKey,
  moveNotes,
  noteName,
  notesEnd,
  notesInRect,
  pitchToFrequency,
  placeNotes,
  resizeNotes,
  snapBeat,
  sortNotes,
  transposeNotes,
} from './midi'

const note = (pitch: number, start: number, length = 1) => createNote({ pitch, start, length })

describe('pitches', () => {
  it('names notes and finds black keys', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(69)).toBe('A4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(0)).toBe('C-1')
    expect(isBlackKey(61)).toBe(true)
    expect(isBlackKey(64)).toBe(false)
    expect(pitchToFrequency(69)).toBe(440)
    expect(pitchToFrequency(81)).toBeCloseTo(880)
  })
})

describe('note edits', () => {
  it('snaps beats to the grid, never below zero', () => {
    expect(snapBeat(1.13, 0.25)).toBe(1.25)
    expect(snapBeat(-2, 0.25)).toBe(0)
    expect(snapBeat(1.13, null)).toBe(1.13)
  })

  it('moves notes together, stopping at beat 0 and the keyboard edges', () => {
    const notes = [note(60, 1), note(72, 2)]
    expect(moveNotes(notes, 0.5, 2).map((n) => [n.start, n.pitch])).toEqual([
      [1.5, 62],
      [2.5, 74],
    ])
    expect(moveNotes(notes, -5, 0).map((n) => n.start)).toEqual([0, 1])
    expect(moveNotes(notes, 0, 100).map((n) => n.pitch)).toEqual([115, 127])
  })

  it('resizes notes but keeps a minimum length', () => {
    expect(resizeNotes([note(60, 0, 1)], 0.5)[0].length).toBe(1.5)
    expect(resizeNotes([note(60, 0, 1)], -3)[0].length).toBe(MIN_NOTE_LENGTH)
  })

  it('transposes only when every note stays on the keyboard', () => {
    const notes = [note(60, 0), note(120, 0)]
    expect(transposeNotes(notes, -12).map((n) => n.pitch)).toEqual([48, 108])
    expect(transposeNotes(notes, 12)).toBe(notes)
  })

  it('finds notes in a box drawn in any direction', () => {
    const a = note(60, 0, 1)
    const b = note(64, 2, 1)
    const c = note(72, 1, 0.5)
    expect(notesInRect([a, b, c], 2.5, 0.5, 65, 59)).toEqual([a.id, b.id])
    expect(notesInRect([a, b, c], 1, 2, 60, 60)).toEqual([])
  })

  it('places copies with new ids, keeping their spacing', () => {
    const copies = placeNotes([note(60, 4), note(62, 5)], 8)
    expect(copies.map((n) => [n.start, n.pitch])).toEqual([
      [8, 60],
      [9, 62],
    ])
    expect(placeNotes([], 1)).toEqual([])
  })

  it('measures and sorts notes', () => {
    const notes = [note(64, 2, 2), note(60, 0, 1), note(55, 2, 1)]
    expect(notesEnd(notes)).toBe(4)
    expect(sortNotes(notes).map((n) => n.pitch)).toEqual([60, 55, 64])
  })

  it('maps a clip span to beats', () => {
    // At 120 BPM a beat lasts 0.5 s: offset 1 s and 2 s long = beats 2 to 6.
    expect(clipBeatRange({ offset: 1, duration: 2 }, 120)).toEqual({ from: 2, to: 6 })
  })
})
