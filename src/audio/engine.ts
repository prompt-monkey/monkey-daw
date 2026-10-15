// Live playback: a look-ahead scheduler that keeps ~120 ms of audio queued ahead of the
// AudioContext clock, so playback stays sample-accurate even when the main thread stutters.

import { ensureEffectWorklets } from '../effects/nodes'
import { createProject } from '../model/factory'
import type { Id, Project } from '../model/types'
import { AssetRegistry } from './assets'
import { getAudioContext } from './context'
import { MixGraph, type MeterReading, type Voice } from './graph'
import { beatsInWindow, scheduleClick } from './metronome'
import { PlaybackPlanner, clipEvents, noteEvents, patternProject } from './schedule'
import { clipBuffer, onStretchReady, prepareStretches } from './stretch'

const TICK_MS = 25
/** Delay before the first scheduled audio, so the first window is never late. */
const START_DELAY = 0.03

/** Wait after the last change before stretching audio (a tempo drag makes many changes). */
const STRETCH_DELAY_MS = 250

/** True when something that affects which clips play changed (not just mixer values). */
function timelineChanged(prev: Project, next: Project): boolean {
  if (prev.loop !== next.loop || prev.assets !== next.assets || prev.bpm !== next.bpm || prev.syncMode !== next.syncMode) return true
  if (prev.tracks.length !== next.tracks.length) return true
  return next.tracks.some(
    (t, i) =>
      t.id !== prev.tracks[i].id ||
      t.clips !== prev.tracks[i].clips ||
      t.instrument !== prev.tracks[i].instrument ||
      t.kit !== prev.tracks[i].kit,
  )
}

export class AudioEngine {
  readonly assets = new AssetRegistry()
  private project: Project = createProject()
  private ctx: AudioContext | null = null
  private mix: MixGraph | null = null
  private planner: PlaybackPlanner | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private voices = new Set<Voice>()
  /** Where the playhead rests while stopped; automated controls hold their value there. */
  private restingPosition = 0
  /** While recording, playback runs straight through instead of looping. */
  private ignoreLoop = false
  /** Where the current playback started: timeline time and the audio clock time it maps to. */
  private origin: { time: number; ctxTime: number } | null = null
  /** In pattern mode only this clip plays, looping over its length. */
  private pattern: Id | null = null
  private stretchTimer: ReturnType<typeof setTimeout> | null = null
  private writing = new Set<string>()
  /** Seconds of audio kept scheduled ahead of the clock (longer in lite mode). */
  private lookahead = 0.12

  constructor() {
    // Clips that were resampled while their stretched audio was being made switch over to it.
    onStretchReady(() => this.restart())
  }

  /** Metronome settings, read on every scheduling tick. */
  readonly metronome = {
    enabled: false,
    volume: 0.6,
    /** During a count-in, clicks play before this timeline time even when the metronome is off. */
    countInUntil: null as number | null,
  }

  get context(): AudioContext {
    this.ctx ??= getAudioContext()
    return this.ctx
  }

  get isPlaying(): boolean {
    return this.planner !== null
  }

  /** Current level of a track, a bus or the master. Null until audio has been started once. */
  readMeter(channelId: Id | 'master'): MeterReading | null {
    return this.mix?.readMeter(channelId) ?? null
  }

  /**
   * Marks a lane ("channel|target") as being written: playback leaves it alone so the control's
   * live value is heard instead of the old automation.
   */
  setWriting(key: string, on: boolean) {
    if (on === this.writing.has(key)) return
    if (on) this.writing.add(key)
    else this.writing.delete(key)
    this.mix?.setWriting(this.writing)
    this.mix?.sync(this.project, false, this.planner ? null : this.restingPosition)
  }

  /** An effect's live reading (auto-tune's note), or null before audio has started. */
  effectMonitor(channelId: Id | 'master', effectId: Id): unknown {
    return this.mix?.effectMonitor(channelId, effectId) ?? null
  }

  setProject(project: Project) {
    const prev = this.project
    this.project = project
    if (this.stretchTimer) clearTimeout(this.stretchTimer)
    this.stretchTimer = setTimeout(() => void prepareStretches(this.project, this.assets), STRETCH_DELAY_MS)
    this.mix?.sync(project, false, this.planner ? null : this.restingPosition)
    if (this.planner && timelineChanged(prev, project)) this.restart()
  }

  /**
   * Starts playback at `from` (negative values give a lead-in before 0, used for count-ins).
   * With `ignoreLoop`, playback runs past the loop end instead of wrapping (used while recording).
   */
  async play(
    from: number,
    { ignoreLoop = false, pattern = null }: { ignoreLoop?: boolean; /** Clip id to loop on its own. */ pattern?: Id | null } = {},
  ) {
    const ctx = this.context
    if (ctx.state !== 'running') await ctx.resume()
    await ensureEffectWorklets(ctx)
    this.stopVoices()
    this.mix ??= new MixGraph(ctx)
    this.mix.setWriting(this.writing)
    this.mix.sync(this.project, true)
    this.ignoreLoop = ignoreLoop
    this.pattern = pattern
    if (pattern) {
      // Start inside the pattern: at the playhead if it's over the clip, else at the clip start.
      const p = patternProject(this.project, pattern)
      if (p && (from < p.loop.start || from >= p.loop.end)) from = p.loop.start
    }
    this.startPlanner(ctx.currentTime + START_DELAY, from)
    this.tick()
    this.timer ??= setInterval(() => this.tick(), TICK_MS)
  }

  /** Stops playback and returns where the playhead was. */
  stop(): number | null {
    const position = this.position()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.planner = null
    this.origin = null
    this.pattern = null
    this.stopVoices()
    // Stop the automation ramps and hold automated controls where playback stopped.
    this.mix?.sync(this.project, false, position ?? this.restingPosition)
    return position
  }

  setLookahead(seconds: number) {
    this.lookahead = seconds
  }

  /** Tells the engine where the playhead rests while stopped (seek, stop). */
  setRestingPosition(time: number) {
    this.restingPosition = time
    if (!this.planner) this.mix?.sync(this.project, false, time)
  }

  /**
   * The audio clock time at which the playhead reaches `time`, for straight (non-looping)
   * playback. Null when stopped.
   */
  contextTimeAt(time: number): number | null {
    return this.origin ? this.origin.ctxTime + (time - this.origin.time) : null
  }

  private startPlanner(ctxTime: number, time: number) {
    this.planner = new PlaybackPlanner(ctxTime, time)
    this.origin = { time, ctxTime }
  }

  /** Current playhead position in seconds, or null when stopped. */
  position(): number | null {
    if (!this.planner || !this.ctx) return null
    return this.planner.positionAt(this.ctx.currentTime)
  }

  private restart() {
    const position = this.position()
    if (position === null || !this.ctx) return
    this.stopVoices()
    this.startPlanner(this.ctx.currentTime + START_DELAY, position)
    this.tick()
  }

  /** Plays one note on a MIDI or drum track right away (piano roll keyboard, drum pads). */
  async auditionNote(trackId: Id, pitch: number, duration = 0.3, velocity = 0.8) {
    const track = this.project.tracks.find((t) => t.id === trackId)
    if (!track || track.kind === 'audio') return
    const ctx = this.context
    if (ctx.state !== 'running') await ctx.resume()
    await ensureEffectWorklets(ctx)
    if (!this.mix) {
      this.mix = new MixGraph(ctx)
      this.mix.sync(this.project, true, this.restingPosition)
    }
    this.mix.playTrackNote(track, { pitch, velocity, duration, glideFrom: null }, ctx.currentTime + 0.005, this.audio)
  }

  private audio = (assetId: Id) => this.assets.get(assetId)

  private tick() {
    const { planner, mix, ctx } = this
    if (!planner || !mix || !ctx) return
    const project = this.pattern ? patternProject(this.project, this.pattern) : this.project
    if (!project) return
    const loop = this.ignoreLoop ? { ...project.loop, enabled: false } : project.loop
    const { bpm, timeSignature } = project
    const { enabled, volume, countInUntil } = this.metronome
    for (const { window, ctxOffset } of planner.plan(ctx.currentTime + this.lookahead, loop)) {
      if (enabled || countInUntil !== null) {
        for (const beat of beatsInWindow(window.from, window.to, bpm, timeSignature)) {
          if (enabled || beat.time < countInUntil!) scheduleClick(ctx, beat.time + ctxOffset, beat.accent, volume)
        }
      }
      mix.scheduleAutomation(project, window, ctxOffset)
      mix.scheduleEffects(project, window, ctxOffset)
      for (const ev of clipEvents(project, window)) {
        const source = clipBuffer(this.assets, ev)
        if (!source) continue
        const voice = mix.playClip(ev, source, ev.at + ctxOffset, () => this.voices.delete(voice!))
        if (voice) this.voices.add(voice)
      }
      for (const ev of noteEvents(project, window)) {
        const track = project.tracks.find((t) => t.id === ev.trackId)
        if (!track) continue
        const voice = mix.playNoteEvent(ev, track, ev.at + ctxOffset, this.audio, () => this.voices.delete(voice!))
        if (voice) this.voices.add(voice)
      }
    }
  }

  private stopVoices() {
    for (const v of this.voices) v.stop()
    this.voices.clear()
  }
}

export const engine = new AudioEngine()
