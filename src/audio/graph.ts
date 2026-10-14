// The audio node graph for a project. Works on any BaseAudioContext, so live playback and
// offline rendering build the same graph.
//
//   clip voice ─► track: input ─► panner ─► fader ─┬─► out ─► bus input or master input
//                                                  ├─► send gain ─► bus input   (post-fader)
//                                                  └─► meter
//   bus:    input ─► panner ─► fader ─┬─► out ─► master input
//                                     └─► meter
//   master: input ─► fader ─┬─► destination
//                           └─► meter

import type { Id, Project, Send } from '../model/types'
import { gainEnvelope, trackIsAudible, trimEventStart, type ClipEvent } from './schedule'

export interface Voice {
  stop: () => void
}

/** Peak and RMS amplitude per channel (left, right) over the last analysis window. */
export interface MeterReading {
  peak: [number, number]
  rms: [number, number]
}

const SMOOTHING = 0.01
const METER_FFT = 1024

class Meter {
  private analysers: [AnalyserNode, AnalyserNode]
  private data = new Float32Array(METER_FFT)

  constructor(ctx: BaseAudioContext, source: AudioNode) {
    const splitter = ctx.createChannelSplitter(2)
    this.analysers = [ctx.createAnalyser(), ctx.createAnalyser()]
    source.connect(splitter)
    this.analysers.forEach((a, i) => {
      a.fftSize = METER_FFT
      splitter.connect(a, i)
    })
  }

  read(): MeterReading {
    const peak: [number, number] = [0, 0]
    const rms: [number, number] = [0, 0]
    this.analysers.forEach((a, i) => {
      a.getFloatTimeDomainData(this.data)
      let max = 0
      let sum = 0
      for (const v of this.data) {
        const abs = Math.abs(v)
        if (abs > max) max = abs
        sum += v * v
      }
      peak[i] = max
      rms[i] = Math.sqrt(sum / this.data.length)
    })
    return { peak, rms }
  }
}

interface Strip {
  input: GainNode
  panner: StereoPannerNode
  fader: GainNode
  /** Unity gain node after the fader; re-pointed when the routing changes. */
  out: GainNode
  meter: Meter
  /** Id of the node `out` currently feeds ('master' or a bus id). */
  routeTo: string | null
  sends: Map<Id, GainNode>
}

export class MixGraph {
  readonly ctx: BaseAudioContext
  private masterInput: GainNode
  private masterFader: GainNode
  private masterMeter: Meter
  private tracks = new Map<Id, Strip>()
  private buses = new Map<Id, Strip>()
  /** The node each strip's `out` currently feeds. */
  private connectedTo = new WeakMap<Strip, AudioNode>()

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.masterInput = ctx.createGain()
    this.masterFader = ctx.createGain()
    this.masterInput.connect(this.masterFader).connect(ctx.destination)
    this.masterMeter = new Meter(ctx, this.masterFader)
  }

  /** Brings nodes, routing and parameters in line with the project. `immediate` skips smoothing. */
  sync(project: Project, immediate = false) {
    this.prune(this.buses, new Set(project.buses.map((b) => b.id)))
    this.prune(this.tracks, new Set(project.tracks.map((t) => t.id)))

    for (const bus of project.buses) {
      const [strip, isNew] = this.ensure(this.buses, bus.id)
      this.route(strip, 'master', this.masterInput)
      this.setParam(strip.fader.gain, bus.muted ? 0 : bus.volume, immediate || isNew)
      this.setParam(strip.panner.pan, bus.pan, immediate || isNew)
    }

    for (const track of project.tracks) {
      const [strip, isNew] = this.ensure(this.tracks, track.id)
      const bus = track.output === 'master' ? undefined : this.buses.get(track.output)
      if (bus) this.route(strip, track.output, bus.input)
      else this.route(strip, 'master', this.masterInput)
      this.syncSends(strip, track.sends, immediate)
      const gain = trackIsAudible(track, project.tracks) ? track.volume : 0
      this.setParam(strip.fader.gain, gain, immediate || isNew)
      this.setParam(strip.panner.pan, track.pan, immediate || isNew)
    }

    this.setParam(this.masterFader.gain, project.master.muted ? 0 : project.master.volume, immediate)
  }

  /** Meter reading for a track, a bus, or 'master'. */
  readMeter(channelId: Id | 'master'): MeterReading | null {
    if (channelId === 'master') return this.masterMeter.read()
    return (this.tracks.get(channelId) ?? this.buses.get(channelId))?.meter.read() ?? null
  }

  /** Plays a clip event with the event's timeline time mapped to `when` (AudioContext time). */
  playClip(event: ClipEvent, buffer: AudioBuffer, when: number, onEnded?: () => void): Voice | null {
    const strip = this.tracks.get(event.trackId)
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
    for (const strip of [...this.tracks.values(), ...this.buses.values()]) this.disconnect(strip)
    this.tracks.clear()
    this.buses.clear()
    this.masterFader.disconnect()
    this.masterInput.disconnect()
  }

  private ensure(map: Map<Id, Strip>, id: Id): [Strip, boolean] {
    const existing = map.get(id)
    if (existing) return [existing, false]
    const ctx = this.ctx
    const fader = ctx.createGain()
    const strip: Strip = {
      input: ctx.createGain(),
      panner: ctx.createStereoPanner(),
      fader,
      out: ctx.createGain(),
      meter: new Meter(ctx, fader),
      routeTo: null,
      sends: new Map(),
    }
    strip.input.connect(strip.panner).connect(strip.fader).connect(strip.out)
    map.set(id, strip)
    return [strip, true]
  }

  private prune(map: Map<Id, Strip>, keep: Set<Id>) {
    for (const [id, strip] of map) {
      if (keep.has(id)) continue
      this.disconnect(strip)
      map.delete(id)
    }
  }

  private disconnect(strip: Strip) {
    strip.fader.disconnect()
    strip.out.disconnect()
    for (const send of strip.sends.values()) send.disconnect()
  }

  private route(strip: Strip, target: string, node: AudioNode) {
    // A bus that was deleted and restored (undo) gets a new input node, so compare nodes too.
    if (strip.routeTo === target && this.connectedTo.get(strip) === node) return
    strip.out.disconnect()
    strip.out.connect(node)
    strip.routeTo = target
    this.connectedTo.set(strip, node)
  }

  private syncSends(strip: Strip, sends: Send[], immediate: boolean) {
    const wanted = new Map(sends.filter((s) => this.buses.has(s.busId)).map((s) => [s.busId, s.level]))
    for (const [busId, node] of strip.sends) {
      if (wanted.has(busId)) continue
      node.disconnect()
      strip.sends.delete(busId)
    }
    for (const [busId, level] of wanted) {
      let node = strip.sends.get(busId)
      const isNew = !node
      if (!node) {
        node = this.ctx.createGain()
        strip.fader.connect(node)
        node.connect(this.buses.get(busId)!.input)
        strip.sends.set(busId, node)
      }
      this.setParam(node.gain, level, immediate || isNew)
    }
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
