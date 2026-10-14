// The audio node graph for a project: one strip per track feeding the master.
// Works on any BaseAudioContext, so live playback and offline rendering build the same graph.
//
//   clip voice ─► strip.input ─► panner ─► fader ─► master ─► (analyser) ─► destination

import type { Id, Project } from '../model/types'
import { gainEnvelope, trackIsAudible, trimEventStart, type ClipEvent } from './schedule'

interface TrackStrip {
  input: GainNode
  panner: StereoPannerNode
  fader: GainNode
}

export interface Voice {
  stop: () => void
}

const SMOOTHING = 0.01

export class MixGraph {
  readonly ctx: BaseAudioContext
  readonly master: GainNode
  readonly analyser: AnalyserNode
  private strips = new Map<Id, TrackStrip>()

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.master.connect(this.analyser)
    this.analyser.connect(ctx.destination)
  }

  /** Brings nodes and parameters in line with the project. `immediate` skips smoothing. */
  sync(project: Project, immediate = false) {
    const ids = new Set(project.tracks.map((t) => t.id))
    for (const [id, strip] of this.strips) {
      if (ids.has(id)) continue
      strip.fader.disconnect()
      this.strips.delete(id)
    }
    for (const track of project.tracks) {
      let strip = this.strips.get(track.id)
      const isNew = !strip
      if (!strip) {
        strip = { input: this.ctx.createGain(), panner: this.ctx.createStereoPanner(), fader: this.ctx.createGain() }
        strip.input.connect(strip.panner).connect(strip.fader).connect(this.master)
        this.strips.set(track.id, strip)
      }
      const gain = trackIsAudible(track, project.tracks) ? track.volume : 0
      this.setParam(strip.fader.gain, gain, immediate || isNew)
      this.setParam(strip.panner.pan, track.pan, immediate || isNew)
    }
    this.setParam(this.master.gain, project.master.muted ? 0 : project.master.volume, immediate)
  }

  /** Plays a clip event with the event's timeline time mapped to `when` (AudioContext time). */
  playClip(event: ClipEvent, buffer: AudioBuffer, when: number, onEnded?: () => void): Voice | null {
    const strip = this.strips.get(event.trackId)
    if (!strip) return null
    const ev = trimEventStart(event, this.ctx.currentTime - when)
    if (!ev) return null
    const start = when + (ev.at - event.at)

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    const [first, ...rest] = gainEnvelope(ev)
    gain.gain.setValueAtTime(first.value, start + first.time)
    for (const p of rest) gain.gain.linearRampToValueAtTime(p.value, start + p.time)
    source.connect(gain).connect(strip.input)
    source.start(start, ev.assetOffset, ev.duration)

    const cleanup = () => {
      source.disconnect()
      gain.disconnect()
    }
    source.onended = () => {
      cleanup()
      onEnded?.()
    }
    return {
      stop: () => {
        try {
          source.stop()
        } catch {
          // Already stopped.
        }
        cleanup()
      },
    }
  }

  dispose() {
    for (const strip of this.strips.values()) strip.fader.disconnect()
    this.strips.clear()
    this.analyser.disconnect()
    this.master.disconnect()
  }

  private setParam(param: AudioParam, value: number, immediate: boolean) {
    if (immediate) {
      param.cancelScheduledValues(0)
      param.value = value
    } else {
      param.setTargetAtTime(value, this.ctx.currentTime, SMOOTHING)
    }
  }
}
