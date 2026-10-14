// Pure scheduling logic shared by live playback and offline rendering: which clips sound in a
// window of timeline time, and with what gain envelope. No Web Audio calls in this file.

import type { Clip, Id, LoopRegion, Project, Track } from '../model/types'

/** One clip (or the remaining part of one) to be played as a single voice. */
export interface ClipEvent {
  trackId: Id
  clip: Clip
  /** Timeline time where the voice starts. */
  at: number
  /** Seconds into the clip where the voice starts (> 0 when joining a clip mid-way). */
  clipTime: number
  /** Position inside the asset where playback starts. */
  assetOffset: number
  /** How long the voice sounds. */
  duration: number
}

export interface ScheduleWindow {
  from: number
  to: number
  /** Also start clips already sounding at `from` (play start, loop restart). */
  catchUp: boolean
  /** Voices are cut at this time (loop end, render end). */
  cutAt?: number
}

const EPSILON = 1e-6
/** Short ramp used where a voice starts or stops mid-clip, to avoid clicks. */
export const DECLICK = 0.005

export function trackIsAudible(track: Track, tracks: Track[]): boolean {
  if (track.muted) return false
  return !tracks.some((t) => t.solo) || track.solo
}

export function clipEvents(project: Project, w: ScheduleWindow): ClipEvent[] {
  const events: ClipEvent[] = []
  const cutAt = w.cutAt ?? Infinity
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.start + clip.duration
      if (clip.start >= w.to || clipEnd <= w.from + EPSILON) continue
      let at = clip.start
      if (clip.start < w.from) {
        if (!w.catchUp) continue
        at = w.from
      }
      const duration = Math.min(clipEnd, cutAt) - at
      if (duration <= EPSILON) continue
      const clipTime = at - clip.start
      events.push({ trackId: track.id, clip, at, clipTime, assetOffset: clip.offset + clipTime, duration })
    }
  }
  return events
}

/** Drops the first `delta` seconds of an event (used when a voice is scheduled late). */
export function trimEventStart(ev: ClipEvent, delta: number): ClipEvent | null {
  if (delta <= 0) return ev
  if (delta >= ev.duration - EPSILON) return null
  return {
    ...ev,
    at: ev.at + delta,
    clipTime: ev.clipTime + delta,
    assetOffset: ev.assetOffset + delta,
    duration: ev.duration - delta,
  }
}

export interface EnvelopePoint {
  /** Seconds from the voice start. */
  time: number
  value: number
}

/** Clip gain with fades at a clip-local time. */
function clipGainAt(clip: Clip, t: number): number {
  let f = 1
  if (clip.fadeIn > 0) f = Math.min(f, t / clip.fadeIn)
  if (clip.fadeOut > 0) f = Math.min(f, (clip.duration - t) / clip.fadeOut)
  return clip.gain * Math.max(0, Math.min(1, f))
}

/**
 * Piecewise-linear gain envelope for a voice: clip gain, fade-in/out, plus a short declick
 * where the voice joins or leaves a clip mid-way. Point times are relative to the voice start.
 */
export function gainEnvelope(ev: ClipEvent): EnvelopePoint[] {
  const { clip, clipTime, duration } = ev
  const endTime = clipTime + duration
  const startsMidClip = clipTime > EPSILON
  const endsMidClip = endTime < clip.duration - EPSILON
  const declick = Math.min(DECLICK, duration / 2)

  // Clip-local span shaped by the clip's own gain and fades (inside the declick ramps).
  const lo = clipTime + (startsMidClip ? declick : 0)
  const hi = endTime - (endsMidClip ? declick : 0)
  const times = [lo, hi]
  for (const b of [clip.fadeIn, clip.duration - clip.fadeOut]) {
    if (b > lo + EPSILON && b < hi - EPSILON) times.push(b)
  }
  times.sort((a, b) => a - b)

  const points: EnvelopePoint[] = []
  if (startsMidClip) points.push({ time: 0, value: 0 })
  for (const t of times) {
    const time = t - clipTime
    if (points.length && time <= points[points.length - 1].time + EPSILON) continue
    points.push({ time, value: clipGainAt(clip, t) })
  }
  if (endsMidClip) points.push({ time: duration, value: 0 })
  return points
}

/** A loop region is only active when it has a usable length. */
export function loopIsActive(loop: LoopRegion): boolean {
  return loop.enabled && loop.end - loop.start >= 0.05
}

export interface PlannedWindow {
  window: ScheduleWindow
  /** Add to a timeline time to get the AudioContext time. */
  ctxOffset: number
}

/**
 * Walks the timeline forward in AudioContext time, wrapping at the loop end, and hands out the
 * windows the engine must schedule. Also maps AudioContext time back to the playhead position.
 */
export class PlaybackPlanner {
  private cursorCtx: number
  private cursorTime: number
  private catchUp = true
  private anchors: { ctx: number; time: number }[]

  constructor(startCtx: number, startTime: number) {
    this.cursorCtx = startCtx
    this.cursorTime = startTime
    this.anchors = [{ ctx: startCtx, time: startTime }]
  }

  plan(ctxUntil: number, loop: LoopRegion): PlannedWindow[] {
    const out: PlannedWindow[] = []
    while (this.cursorCtx < ctxUntil - EPSILON) {
      const from = this.cursorTime
      let to = from + (ctxUntil - this.cursorCtx)
      const wraps = loopIsActive(loop) && from < loop.end && to >= loop.end
      if (wraps) to = loop.end
      out.push({
        window: { from, to, catchUp: this.catchUp, cutAt: wraps ? loop.end : undefined },
        ctxOffset: this.cursorCtx - from,
      })
      this.cursorCtx += to - from
      if (wraps) {
        this.cursorTime = loop.start
        this.catchUp = true
        this.anchors.push({ ctx: this.cursorCtx, time: loop.start })
        if (this.anchors.length > 16) this.anchors.shift()
      } else {
        this.cursorTime = to
        this.catchUp = false
      }
    }
    return out
  }

  positionAt(ctxTime: number): number {
    let anchor = this.anchors[0]
    for (const a of this.anchors) if (a.ctx <= ctxTime) anchor = a
    return anchor.time + Math.max(0, ctxTime - anchor.ctx)
  }
}
