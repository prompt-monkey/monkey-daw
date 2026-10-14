import { secondsPerBar, secondsPerBeat } from '../model/grid'
import type { TimeSignature } from '../model/types'

export const HEADER_WIDTH = 248
export const RULER_HEIGHT = 40
/** Top part of the ruler where the loop region is dragged. */
export const LOOP_STRIP_HEIGHT = 14
export const TRACK_HEIGHTS = { normal: 96, compact: 56 } as const
export type TrackHeight = keyof typeof TRACK_HEIGHTS

export const MIN_PPS = 4
export const MAX_PPS = 1200
export const DEFAULT_PPS = 40

/** Minimum spacing between labelled bars on the ruler, in pixels. */
const MIN_LABEL_SPACING = 56
/** Beat ticks are drawn only when beats are at least this far apart. */
const MIN_BEAT_SPACING = 8

export const clampPps = (pps: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, pps))

export interface RulerTick {
  time: number
  kind: 'bar' | 'beat'
  /** Bar number, set on labelled bars only. */
  label?: string
}

/** How many bars apart labelled bars are at this zoom (1, 2, 4, 8…). */
export function barLabelStep(pps: number, bpm: number, ts: TimeSignature): number {
  const barPx = secondsPerBar(bpm, ts) * pps
  let step = 1
  while (step * barPx < MIN_LABEL_SPACING) step *= 2
  return step
}

/** Ruler ticks between t0 and t1, thinned out so they stay legible at any zoom. */
export function rulerTicks(pps: number, bpm: number, ts: TimeSignature, t0: number, t1: number): RulerTick[] {
  const bar = secondsPerBar(bpm, ts)
  const beat = secondsPerBeat(bpm, ts)
  const step = barLabelStep(pps, bpm, ts)
  const showBeats = beat * pps >= MIN_BEAT_SPACING
  // When bars are tightly packed, unlabelled bars are thinned out too.
  const barStep = bar * pps >= MIN_BEAT_SPACING ? 1 : step
  const ticks: RulerTick[] = []
  const first = Math.max(0, Math.floor(t0 / bar))
  const last = Math.ceil(t1 / bar)
  for (let i = first - (first % barStep); i <= last; i += barStep) {
    const time = i * bar
    ticks.push(i % step === 0 ? { time, kind: 'bar', label: String(i + 1) } : { time, kind: 'bar' })
    if (!showBeats) continue
    for (let b = 1; b < ts.beats; b++) {
      const bt = time + b * beat
      if (bt >= t0 && bt <= t1) ticks.push({ time: bt, kind: 'beat' })
    }
  }
  return ticks.filter((t) => t.time >= t0 - 1e-9 && t.time <= t1 + 1e-9)
}

/** CSS background drawing bar and beat lines behind the lanes. */
export function laneGridBackground(pps: number, bpm: number, ts: TimeSignature): { backgroundImage: string; backgroundSize: string } {
  const barPx = secondsPerBar(bpm, ts) * pps * (secondsPerBar(bpm, ts) * pps >= MIN_BEAT_SPACING ? 1 : barLabelStep(pps, bpm, ts))
  const beatPx = secondsPerBeat(bpm, ts) * pps
  const barLine = `linear-gradient(to right, var(--color-grid-bar) 1px, transparent 1px)`
  if (beatPx < MIN_BEAT_SPACING) return { backgroundImage: barLine, backgroundSize: `${barPx}px 100%` }
  const beatLine = `linear-gradient(to right, var(--color-grid-beat) 1px, transparent 1px)`
  return { backgroundImage: `${barLine}, ${beatLine}`, backgroundSize: `${barPx}px 100%, ${beatPx}px 100%` }
}
