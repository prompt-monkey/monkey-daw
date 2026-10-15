// Graphic pitch editing, the pure part: find the sung pitch of a recording, group it into notes,
// and render the recording with notes moved up or down. Runs in a worker (pitch.worker.ts).

import { SyncShifter, detectPitch } from '../effects/specialist-dsp'
import type { PitchEdit } from '../model/types'

/** The pitch of a recording over time: one frame every `hop` seconds, NaN where unpitched. */
export interface PitchTrack {
  hop: number
  midi: Float32Array
}

/** A sung note: where it is in the recording (seconds) and its pitch (median, fractional MIDI). */
export interface PitchNote {
  start: number
  end: number
  midi: number
}

/** A stretch of the recording moved by `shift` semitones. */
export type PitchSegment = PitchEdit

/** Analysis runs on a 4× down-sampled copy: plenty for voices, and fast. */
const DECIMATE = 4
const BLOCK = 512
const HOP = 64

const toMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** A mono copy at a quarter of the sample rate (each output sample averages four). */
function downsample(channels: Float32Array[]): Float32Array {
  const length = Math.floor((channels[0]?.length ?? 0) / DECIMATE)
  const out = new Float32Array(length)
  for (const c of channels) {
    for (let i = 0; i < length; i++) {
      let sum = 0
      for (let k = 0; k < DECIMATE; k++) sum += c[i * DECIMATE + k]
      out[i] += sum / DECIMATE / channels.length
    }
  }
  return out
}

/** Follows the pitch of a recording (YIN, every ~6 ms at 44.1 kHz). */
export function analysePitch(channels: Float32Array[], sampleRate: number): PitchTrack {
  const x = downsample(channels)
  const rate = sampleRate / DECIMATE
  const frames = Math.max(0, Math.floor((x.length - BLOCK) / HOP) + 1)
  const midi = new Float32Array(frames).fill(NaN)
  for (let f = 0; f < frames; f++) {
    const block = x.subarray(f * HOP, f * HOP + BLOCK)
    let level = 0
    for (const v of block) level = Math.max(level, Math.abs(v))
    if (level < 0.01) continue
    const hz = detectPitch(block, rate, 70, 1000, 0.12)
    if (hz) midi[f] = toMidi(hz)
  }
  return { hop: HOP / rate, midi }
}

/** The pitch (fractional MIDI) at a time in the recording, or null where unpitched. */
export function pitchAt(track: PitchTrack, time: number): number | null {
  // A frame describes the block it starts, so it is centred half a block later.
  const f = Math.round((time - (BLOCK / 2) * (track.hop / HOP)) / track.hop)
  const v = track.midi[Math.min(track.midi.length - 1, Math.max(0, f))]
  return Number.isNaN(v) ? null : v
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Groups a pitch track into notes: runs of pitched frames, split where the pitch moves more than
 * ~0.7 semitone from where the note sits, or where it stops for more than 40 ms. Shorter than
 * 60 ms, it isn't a note.
 */
export function segmentNotes(track: PitchTrack, minLength = 0.06, gap = 0.04, jump = 0.7): PitchNote[] {
  const notes: PitchNote[] = []
  const centre = track.hop * (BLOCK / HOP / 2)
  let current: number[] = []
  let startFrame = 0
  let unpitched = 0
  const close = (endFrame: number) => {
    const start = startFrame * track.hop + centre
    const end = endFrame * track.hop + centre
    if (current.length && end - start >= minLength) notes.push({ start, end, midi: median(current) })
    current = []
  }
  for (let f = 0; f < track.midi.length; f++) {
    const m = track.midi[f]
    if (Number.isNaN(m)) {
      if (current.length && ++unpitched * track.hop > gap) {
        close(f - unpitched + 1)
        unpitched = 0
      }
      continue
    }
    unpitched = 0
    if (current.length && Math.abs(m - median(current.slice(-12))) > jump) {
      close(f)
    }
    if (!current.length) startFrame = f
    current.push(m)
  }
  close(track.midi.length)
  return notes
}

/** Seconds the shift takes to change between segments, so moved notes don't click. */
const RAMP = 0.015

/** The shift (semitones) at a time: segments' shifts, ramped at their edges. */
export function shiftAt(segments: PitchSegment[], time: number): number {
  for (const s of segments) {
    if (time < s.start - RAMP || time > s.end + RAMP) continue
    const fadeIn = Math.min(1, (time - (s.start - RAMP)) / RAMP)
    const fadeOut = Math.min(1, (s.end + RAMP - time) / RAMP)
    return s.shift * Math.min(fadeIn, fadeOut)
  }
  return 0
}

/**
 * The recording with its segments moved in pitch, the same length and in time (the shifter's
 * delay is taken back out). Unpitched parts pass through untouched.
 */
export function renderPitchEdits(channels: Float32Array[], sampleRate: number, track: PitchTrack, segments: PitchSegment[]): Float32Array[] {
  const length = channels[0]?.length ?? 0
  const latency = Math.round(0.025 * sampleRate)
  return channels.map((input) => {
    const shifter = new SyncShifter(sampleRate)
    const out = new Float32Array(length)
    for (let i = 0; i < length + latency; i++) {
      // The shifter plays what came in `latency` samples ago: shift by where that audio is.
      const t = (i - latency) / sampleRate
      const shift = shiftAt(segments, t)
      const midi = shift ? pitchAt(track, t) : null
      const period = midi === null ? null : sampleRate / (440 * 2 ** ((midi - 69) / 12))
      const y = shifter.next(i < length ? input[i] : 0, 2 ** (shift / 12), period)
      if (i >= latency) out[i - latency] = y
    }
    return out
  })
}
