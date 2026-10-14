// Live playback: a look-ahead scheduler that keeps ~120 ms of audio queued ahead of the
// AudioContext clock, so playback stays sample-accurate even when the main thread stutters.

import { createProject } from '../model/factory'
import type { Project } from '../model/types'
import { AssetRegistry } from './assets'
import { getAudioContext } from './context'
import { MixGraph, type Voice } from './graph'
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

  get context(): AudioContext {
    this.ctx ??= getAudioContext()
    return this.ctx
  }

  get isPlaying(): boolean {
    return this.planner !== null
  }

  /** Master analyser, for meters. Null until audio has been started once. */
  get analyser(): AnalyserNode | null {
    return this.mix?.analyser ?? null
  }

  setProject(project: Project) {
    const prev = this.project
    this.project = project
    this.mix?.sync(project)
    if (this.planner && timelineChanged(prev, project)) this.restart()
  }

  async play(from: number) {
    const ctx = this.context
    if (ctx.state !== 'running') await ctx.resume()
    this.stopVoices()
    this.mix ??= new MixGraph(ctx)
    this.mix.sync(this.project, true)
    this.planner = new PlaybackPlanner(ctx.currentTime + START_DELAY, Math.max(0, from))
    this.tick()
    this.timer ??= setInterval(() => this.tick(), TICK_MS)
  }

  /** Stops playback and returns where the playhead was. */
  stop(): number | null {
    const position = this.position()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.planner = null
    this.stopVoices()
    return position
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
    this.planner = new PlaybackPlanner(this.ctx.currentTime + START_DELAY, position)
    this.tick()
  }

  private tick() {
    const { planner, mix, ctx } = this
    if (!planner || !mix || !ctx) return
    for (const { window, ctxOffset } of planner.plan(ctx.currentTime + LOOKAHEAD, this.project.loop)) {
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
