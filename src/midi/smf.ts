// Standard MIDI File (.mid) reader: notes only. Each track/channel pair with notes becomes one
// part; times are converted from ticks to beats (quarter notes).

import type { Note } from '../model/types'

export interface MidiPart {
  name: string
  /** 0-based MIDI channel; 9 (channel 10) is drums in General MIDI. */
  channel: number
  notes: Omit<Note, 'id'>[]
}

export interface MidiFile {
  parts: MidiPart[]
  /** Tempo of the first tempo event, if the file has one. */
  bpm: number | null
}

export class InvalidMidiFileError extends Error {}

class Reader {
  pos = 0
  private bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get done() {
    return this.pos >= this.bytes.length
  }

  /** The rest of the bytes as UTF-8 text (names in older files may be Latin-1; close enough). */
  rest(): string {
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos))
    this.pos = this.bytes.length
    return s
  }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new InvalidMidiFileError('The MIDI file ends too early.')
    return this.bytes[this.pos++]
  }

  u16(): number {
    return (this.u8() << 8) | this.u8()
  }

  u32(): number {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8()
  }

  text(length: number): string {
    let s = ''
    for (let i = 0; i < length; i++) s += String.fromCharCode(this.u8())
    return s
  }

  /** Variable-length quantity: 7 bits per byte, high bit set on all but the last. */
  vlq(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8()
      value = (value << 7) | (b & 0x7f)
      if (!(b & 0x80)) return value
    }
    throw new InvalidMidiFileError('The MIDI file is damaged.')
  }

  skip(length: number) {
    this.pos += length
  }

  sub(length: number): Reader {
    const r = new Reader(this.bytes.subarray(this.pos, this.pos + length))
    this.pos += length
    return r
  }
}

export function parseMidiFile(bytes: Uint8Array): MidiFile {
  const r = new Reader(bytes)
  if (bytes.length < 14 || r.text(4) !== 'MThd') throw new InvalidMidiFileError('This is not a MIDI file.')
  const headerLength = r.u32()
  const header = r.sub(headerLength)
  header.u16() // format: 0, 1 or 2 are all read the same way here
  const trackCount = header.u16()
  const division = header.u16()
  if (division & 0x8000) throw new InvalidMidiFileError('MIDI files timed in SMPTE frames are not supported.')
  if (division === 0) throw new InvalidMidiFileError('The MIDI file is damaged.')

  let bpm: number | null = null
  const parts: MidiPart[] = []

  for (let t = 0; t < trackCount && !r.done; t++) {
    const id = r.text(4)
    const length = r.u32()
    if (id !== 'MTrk') {
      r.skip(length)
      continue
    }
    const tr = r.sub(length)
    let tick = 0
    let status = 0
    let trackName = ''
    const byChannel = new Map<number, Omit<Note, 'id'>[]>()
    /** Notes waiting for their note-off, by channel and pitch. */
    const open = new Map<string, { start: number; velocity: number }[]>()

    const close = (channel: number, pitch: number, at: number) => {
      const started = open.get(`${channel}:${pitch}`)?.shift()
      if (!started) return
      const list = byChannel.get(channel) ?? []
      list.push({ pitch, start: started.start / division, length: Math.max(1, at - started.start) / division, velocity: started.velocity })
      byChannel.set(channel, list)
    }

    while (!tr.done) {
      tick += tr.vlq()
      let byte = tr.u8()
      if (byte === 0xff) {
        const type = tr.u8()
        const data = tr.sub(tr.vlq())
        if (type === 0x03 && !trackName) trackName = data.rest().trim()
        if (type === 0x51 && bpm === null) bpm = Math.round((60_000_000 / ((data.u8() << 16) | (data.u8() << 8) | data.u8())) * 100) / 100
        if (type === 0x2f) break
        continue
      }
      if (byte === 0xf0 || byte === 0xf7) {
        tr.skip(tr.vlq())
        continue
      }
      // Running status: a data byte reuses the previous status.
      if (byte < 0x80) {
        if (!status) throw new InvalidMidiFileError('The MIDI file is damaged.')
        tr.pos--
        byte = status
      } else {
        status = byte
      }
      const kind = byte & 0xf0
      const channel = byte & 0x0f
      if (kind === 0xc0 || kind === 0xd0) {
        tr.u8()
        continue
      }
      const a = tr.u8()
      const b = tr.u8()
      if (kind === 0x90 && b > 0) {
        const key = `${channel}:${a}`
        open.set(key, [...(open.get(key) ?? []), { start: tick, velocity: b / 127 }])
      } else if (kind === 0x80 || kind === 0x90) {
        close(channel, a, tick)
      }
    }
    // Notes never released end with the track.
    for (const key of [...open.keys()]) {
      const [channel, pitch] = key.split(':').map(Number)
      while (open.get(key)?.length) close(channel, pitch, tick)
    }

    const channels = [...byChannel.keys()].sort((x, y) => x - y)
    for (const channel of channels) {
      const base = trackName || `Track ${t + 1}`
      const name = channels.length > 1 ? `${base} · ch ${channel + 1}` : base
      parts.push({ name, channel, notes: byChannel.get(channel)!.sort((x, y) => x.start - y.start || x.pitch - y.pitch) })
    }
  }

  return { parts, bpm }
}
