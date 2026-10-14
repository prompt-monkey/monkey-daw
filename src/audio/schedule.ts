// Pure scheduling logic shared by live playback and offline rendering: which clips sound in a
// window of timeline time, and with what gain envelope. No Web Audio calls in this file.

import { beatSeconds } from '../model/midi'
import { isMidiClip, type AudioClip, type Clip, type Id, type LoopRegion, type Project, type Track } from '../model/types'

/** One audio clip (or the remaining part of one) to be played as a single voice. */
export interface ClipEvent {
  trackId: Id
  clip: AudioClip
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
      if (isMidiClip(clip)) continue
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

/** One note to be played by a track's instrument, or one hit of a drum pad. */
export interface NoteEvent {
  trackId: Id
  clipId: Id
  pitch: number
  /** Note velocity times the clip's gain and fades at the note start. */
  velocity: number
  /** Timeline time where the note starts sounding. */
  at: number
  /** How long the note is held, before the instrument's release. */
  duration: number
  /** With glide on: the pitch to slide from (the note this one follows legato). */
  glideFrom: number | null
}

/**
 * Notes of MIDI clips that start in the window (and, with catchUp, notes already held at its
 * start). Notes are cut at the clip edges and at `cutAt`. With glide on, an instrument plays one
 * note at a time: each note ends where the next begins, and slides from a note it overlaps.
 */
export function noteEvents(project: Project, w: ScheduleWindow): NoteEvent[] {
  const events: NoteEvent[] = []
  const cutAt = w.cutAt ?? Infinity
  const spb = beatSeconds(project.bpm)
  for (const track of project.tracks) {
    if (track.kind === 'audio' || (!track.instrument && !track.kit)) continue
    const mono = (track.instrument?.glide ?? 0) > 0
    for (const clip of track.clips) {
      if (!isMidiClip(clip)) continue
      const clipEnd = Math.min(clip.start + clip.duration, cutAt)
      if (clip.start >= w.to || clipEnd <= w.from + EPSILON) continue
      const origin = clip.start - clip.offset
      const notes = clip.notes
      notes.forEach((note, i) => {
        let endBeat = note.start + note.length
        let glideFrom: number | null = null
        if (mono) {
          const next = notes.slice(i + 1).find((n) => n.start > note.start + EPSILON)
          if (next) endBeat = Math.min(endBeat, next.start)
          const prev = notes.slice(0, i).findLast((n) => n.start < note.start - EPSILON)
          if (prev && prev.start + prev.length >= note.start - EPSILON) glideFrom = prev.pitch
        }
        const noteStart = Math.max(origin + note.start * spb, clip.start)
        const noteEnd = Math.min(origin + endBeat * spb, clipEnd)
        if (noteEnd - noteStart <= EPSILON) return
        let at = noteStart
        if (noteStart < w.from || noteStart >= w.to) {
          if (!w.catchUp || noteStart >= w.from || noteEnd <= w.from + EPSILON) return
          at = w.from
        }
        // A note clipped by the clip's start (trimmed head) is joined, like a catch-up.
        const velocity = note.velocity * clipGainAt(clip, noteStart - clip.start)
        events.push({ trackId: track.id, clipId: clip.id, pitch: note.pitch, velocity, at, duration: noteEnd - at, glideFrom })
      })
    }
  }
  return events
}

/**
 * The project as heard in pattern mode: only one clip plays, looping over its own length. The
 * clip is looked up on every track (it may have moved). Null when it no longer exists.
 */
export function patternProject(project: Project, clipId: Id): Project | null {
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId))
  const clip = track?.clips.find((c) => c.id === clipId)
  if (!track || !clip) return null
  return {
    ...project,
    loop: { enabled: true, start: clip.start, end: clip.start + clip.duration },
    tracks: project.tracks.map((t) => ({ ...t, clips: t === track ? [clip] : [] })),
  }
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
export function clipGainAt(clip: Clip, t: number): number {
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
