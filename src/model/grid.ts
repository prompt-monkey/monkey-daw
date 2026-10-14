import type { SnapMode, TimeSignature } from './types'

// BPM counts quarter notes, as in most DAWs. A beat is the time signature's unit note,
// so in 6/8 at 120 BPM an eighth-note beat lasts 0.25 s and a bar lasts 1.5 s.

export function secondsPerBeat(bpm: number, ts: TimeSignature): number {
  return (60 / bpm) * (4 / ts.unit)
}

export function secondsPerBar(bpm: number, ts: TimeSignature): number {
  return secondsPerBeat(bpm, ts) * ts.beats
}

export function snapStep(mode: SnapMode, bpm: number, ts: TimeSignature): number | null {
  if (mode === 'off') return null
  return mode === 'bar' ? secondsPerBar(bpm, ts) : secondsPerBeat(bpm, ts)
}

/** Rounds a time to the nearest grid line for the snap mode; never returns a negative time. */
export function snapTime(seconds: number, mode: SnapMode, bpm: number, ts: TimeSignature): number {
  const step = snapStep(mode, bpm, ts)
  const t = Math.max(0, seconds)
  if (step === null) return t
  return Math.round(t / step) * step
}

/** 1-based bar and beat at a time, e.g. { bar: 3, beat: 2 }. */
export function barBeatAt(seconds: number, bpm: number, ts: TimeSignature): { bar: number; beat: number } {
  const beatIndex = Math.floor(Math.max(0, seconds) / secondsPerBeat(bpm, ts) + 1e-9)
  return { bar: Math.floor(beatIndex / ts.beats) + 1, beat: (beatIndex % ts.beats) + 1 }
}

/** Formats seconds as mm:ss.mmm. */
export function formatTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const rest = ms % 1000
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`
}
