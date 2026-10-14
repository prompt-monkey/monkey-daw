import { describe, expect, it } from 'vitest'
import { InvalidMidiFileError, parseMidiFile } from './smf'

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const text = (s: string) => [...s].map((c) => c.charCodeAt(0))
/** Variable-length quantity. */
const vlq = (n: number) => {
  const out = [n & 0x7f]
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80)
  return out
}

function midiFile(division: number, tracks: number[][]): Uint8Array {
  const header = [...text('MThd'), ...u32(6), 0, 1, 0, tracks.length, (division >> 8) & 0xff, division & 0xff]
  const body = tracks.flatMap((events) => [...text('MTrk'), ...u32(events.length), ...events])
  return new Uint8Array([...header, ...body])
}

const END = [0x00, 0xff, 0x2f, 0x00]

describe('parseMidiFile', () => {
  it('reads notes, names and the tempo', () => {
    const tempo = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] // 500000 µs per beat = 120 BPM
    const name = [0x00, 0xff, 0x03, 0x04, ...text('Lead')]
    const notes = [
      ...[0x00, 0x90, 60, 100], // C4 on at 0
      ...[...vlq(480), 0x80, 60, 0], // off after one beat
      ...[0x00, 0x90, 64, 127], // E4 on
      ...[...vlq(240), 64, 0], // running status, velocity 0 = off
    ]
    const p = parseMidiFile(midiFile(480, [[...tempo, ...END], [...name, ...notes, ...END]]))
    expect(p.bpm).toBe(120)
    expect(p.parts).toEqual([
      {
        name: 'Lead',
        channel: 0,
        notes: [
          { pitch: 60, start: 0, length: 1, velocity: 100 / 127 },
          { pitch: 64, start: 1, length: 0.5, velocity: 1 },
        ],
      },
    ])
  })

  it('splits channels into parts and closes notes left open', () => {
    const events = [
      ...[0x00, 0x90, 60, 64],
      ...[0x00, 0x99, 36, 64], // channel 10
      ...[...vlq(96), 0x89, 36, 0],
      ...[...vlq(96), 0xff, 0x2f, 0x00],
    ]
    const p = parseMidiFile(midiFile(96, [events]))
    expect(p.parts.map((x) => x.name)).toEqual(['Track 1 · ch 1', 'Track 1 · ch 10'])
    expect(p.parts.map((x) => x.channel)).toEqual([0, 9])
    expect(p.parts[0].notes[0]).toMatchObject({ pitch: 60, length: 2 })
    expect(p.parts[1].notes[0]).toMatchObject({ pitch: 36, length: 1 })
  })

  it('skips sysex and other channel messages', () => {
    const events = [
      ...[0x00, 0xf0, 0x03, 0x7e, 0x7f, 0xf7],
      ...[0x00, 0xc0, 5], // program change: one data byte
      ...[0x00, 0xb0, 7, 100], // controller
      ...[0x00, 0x90, 62, 80],
      ...[...vlq(48), 0x80, 62, 0],
      ...END,
    ]
    expect(parseMidiFile(midiFile(96, [events])).parts[0].notes).toEqual([{ pitch: 62, start: 0, length: 0.5, velocity: 80 / 127 }])
  })

  it('rejects files that are not MIDI or are timed in SMPTE frames', () => {
    expect(() => parseMidiFile(new TextEncoder().encode('not a midi file'))).toThrow(InvalidMidiFileError)
    const smpte = midiFile(96, [END])
    smpte[12] = 0xe7
    expect(() => parseMidiFile(smpte)).toThrow(/SMPTE/)
  })
})
