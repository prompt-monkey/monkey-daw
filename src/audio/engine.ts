// Live playback: a look-ahead scheduler that keeps ~120 ms of audio queued ahead of the
// AudioContext clock, so playback stays sample-accurate even when the main thread stutters.

import { createProject } from '../model/factory'
import type { Id, Project } from '../model/types'
import { AssetRegistry } from './assets'
import { getAudioContext } from './context'
import { MixGraph, type MeterReading, type Voice } from './graph'
import { beatsInWindow, scheduleClick } from './metronome'
import { PlaybackPlanner, clipEvents } from './schedule'

const TICK_MS = 25
const LOOKAHEAD = 0.12
/** Delay before the first scheduled audio, so the first window is never late. */
const START_DELAY = 0.03

/** True when something that affects which clips play changed (not just mixer values). */
function timelineChanged(prev: Project, next: Project): boolean {
  if (prev.loop !== next.loop || prev.assets !== next.assets) return true
  if (prev.tracks.length !== next.tracks.length) return true
  return next.tracks.some((t, i) => t.id !== prev.tracks[i].id || t.clips !== prev.tracks[i].clips)
}

export class AudioEngine {
  readonly assets = new AssetRegistry()
  private project: Project = createProject()
  private ctx: AudioContext | null = null
  private mix: MixGraph | null = null
  private planner: PlaybackPlanner | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private voices = new Set<Voice>()
  /** While recording, playback runs straight through instead of looping. */
  private ignoreLoop = false
  /** Where the current playback started: timeline time and the audio clock time it maps to. */
  private origin: { time: number; ctxTime: number } | null = null

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

  setProject(project: Project) {
    const prev = this.project
    this.project = project
    this.mix?.sync(project)
    if (this.planner && timelineChanged(prev, project)) this.restart()
  }

  /**
   * Starts playback at `from` (negative values give a lead-in before 0, used for count-ins).
   * With `ignoreLoop`, playback runs past the loop end instead of wrapping (used while recording).
   */
  async play(from: number, { ignoreLoop = false }: { ignoreLoop?: boolean } = {}) {
    const ctx = this.context
    if (ctx.state !== 'running') await ctx.resume()
    this.stopVoices()
    this.mix ??= new MixGraph(ctx)
    this.mix.sync(this.project, true)
    this.ignoreLoop = ignoreLoop
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
    this.stopVoices()
    return position
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

  private tick() {
    const { planner, mix, ctx } = this
    if (!planner || !mix || !ctx) return
    const loop = this.ignoreLoop ? { ...this.project.loop, enabled: false } : this.project.loop
    const { bpm, timeSignature } = this.project
    const { enabled, volume, countInUntil } = this.metronome
    for (const { window, ctxOffset } of planner.plan(ctx.currentTime + LOOKAHEAD, loop)) {
      if (enabled || countInUntil !== null) {
        for (const beat of beatsInWindow(window.from, window.to, bpm, timeSignature)) {
          if (enabled || beat.time < countInUntil!) scheduleClick(ctx, beat.time + ctxOffset, beat.accent, volume)
        }
      }
      for (const ev of clipEvents(this.project, window)) {
        const buffer = this.assets.get(ev.clip.assetId)
        if (!buffer) continue
        const voice = mix.playClip(ev, buffer, ev.at + ctxOffset, () => this.voices.delete(voice!))
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
