// The audio node graph for a project. Works on any BaseAudioContext, so live playback and
// offline rendering build the same graph.
//
//   clip voice ─► track: input ─► effects ─► panner ─► fader ─► audible ─┬─► out ─► bus or master input
//                                                                        ├─► send gain ─► bus input  (post-fader)
//                                                                        └─► meter
//   (fader = volume, possibly automated; audible = mute/solo, so automation never unmutes)
//   bus:    input ─► effects ─► panner ─► fader ─┬─► out ─► master input
//                                     └─► meter
//   master: input ─► effects ─► fader ─┬─► destination
//                           └─► meter

import { EffectChain } from '../effects/chain'
import { sampleRange, valueAt } from '../automation/curve'
import { parseTarget, resolveTarget } from '../automation/targets'
import type { AutomationPoint, Id, Instrument, Project, Send, Track } from '../model/types'
import { playInstrumentNote, type NoteToPlay } from './instruments'
import { gainEnvelope, trackIsAudible, trimEventStart, type ClipEvent, type NoteEvent } from './schedule'

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
  chain: EffectChain
  panner: StereoPannerNode
  fader: GainNode
  /** 1 or 0 for mute/solo, after the fader so volume automation never overrides a mute. */
  audible: GainNode
  /** Unity gain node after the fader; re-pointed when the routing changes. */
  out: GainNode
  meter: Meter
  /** Id of the node `out` currently feeds ('master' or a bus id). */
  routeTo: string | null
  sends: Map<Id, GainNode>
}

/** A track's lanes that have points, by target. Empty lanes don't take control. */
function activeLanes(track: Track): Map<string, AutomationPoint[]> {
  return new Map(track.automation.filter((l) => l.points.length > 0).map((l) => [l.target, l.points]))
}

/** Effect parameters under automation, by effect id, for the effect chain. */
function automatedEffectParams(lanes: Map<string, AutomationPoint[]>): Map<Id, Set<string>> {
  const out = new Map<Id, Set<string>>()
  for (const target of lanes.keys()) {
    const parsed = parseTarget(target)
    if (parsed?.kind !== 'effect') continue
    const keys = out.get(parsed.effectId) ?? new Set<string>()
    keys.add(parsed.param)
    out.set(parsed.effectId, keys)
  }
  return out
}

/** Sets a value after dropping any ramps still scheduled (automation that has been stopped). */
function hold(ctx: BaseAudioContext, param: AudioParam, value: number, immediate: boolean) {
  param.cancelScheduledValues(ctx.currentTime)
  if (immediate) param.setValueAtTime(value, ctx.currentTime)
  else param.setTargetAtTime(value, ctx.currentTime, 0.01)
}

export class MixGraph {
  readonly ctx: BaseAudioContext
  private masterInput: GainNode
  private masterChain: EffectChain
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
    this.masterChain = new EffectChain(ctx)
    this.masterInput.connect(this.masterChain.input)
    this.masterChain.output.connect(this.masterFader).connect(ctx.destination)
    this.masterMeter = new Meter(ctx, this.masterFader)
  }

  /**
   * Brings nodes, routing and parameters in line with the project. `immediate` skips smoothing.
   * `automationTime` holds automated controls at their value at that time (when stopped); null
   * leaves them to scheduleAutomation (while playing).
   */
  sync(project: Project, immediate = false, automationTime: number | null = null) {
    this.prune(this.buses, new Set(project.buses.map((b) => b.id)))
    this.prune(this.tracks, new Set(project.tracks.map((t) => t.id)))

    for (const bus of project.buses) {
      const [strip, isNew] = this.ensure(this.buses, bus.id)
      this.route(strip, 'master', this.masterInput)
      strip.chain.sync(bus.effects, bus.fxBypass, project.bpm, immediate)
      this.setParam(strip.fader.gain, bus.muted ? 0 : bus.volume, immediate || isNew)
      this.setParam(strip.panner.pan, bus.pan, immediate || isNew)
    }

    for (const track of project.tracks) {
      const [strip, isNew] = this.ensure(this.tracks, track.id)
      const bus = track.output === 'master' ? undefined : this.buses.get(track.output)
      if (bus) this.route(strip, track.output, bus.input)
      else this.route(strip, 'master', this.masterInput)
      this.syncSends(strip, track.sends, immediate)
      const lanes = activeLanes(track)
      strip.chain.sync(track.effects, track.fxBypass, project.bpm, immediate, automatedEffectParams(lanes))
      this.setParam(strip.audible.gain, trackIsAudible(track, project.tracks) ? 1 : 0, immediate || isNew)
      if (!lanes.has('volume')) this.setParam(strip.fader.gain, track.volume, immediate || isNew)
      if (!lanes.has('pan')) this.setParam(strip.panner.pan, track.pan, immediate || isNew)
      if (automationTime !== null) {
        for (const [target, points] of lanes) {
          const value = valueAt(points, automationTime)
          const resolved = resolveTarget(track, target)
          if (value === null || !resolved) continue
          for (const { param, map } of this.automationBindings(track, strip, target)) {
            hold(this.ctx, param, map(resolved.toReal(value), project.bpm), immediate || isNew)
          }
        }
      }
    }

    this.masterChain.sync(project.master.effects, project.master.fxBypass, project.bpm, immediate)
    this.setParam(this.masterFader.gain, project.master.muted ? 0 : project.master.volume, immediate)
  }

  /**
   * Schedules every track's automation across a window of timeline time, as ramps on the audio
   * clock (`ctxOffset` maps timeline time to context time). A window that starts fresh (playback
   * start, loop wrap) first jumps to the value at its start.
   */
  scheduleAutomation(project: Project, window: { from: number; to: number; catchUp: boolean }, ctxOffset: number) {
    for (const track of project.tracks) {
      const strip = this.tracks.get(track.id)
      if (!strip) continue
      for (const [target, points] of activeLanes(track)) {
        const resolved = resolveTarget(track, target)
        if (!resolved) continue
        const samples = sampleRange(points, window.from, window.to)
        if (!samples.length) continue
        for (const { param, map } of this.automationBindings(track, strip, target)) {
          const [first, ...rest] = samples
          const start = Math.max(this.ctx.currentTime, first.time + ctxOffset)
          if (window.catchUp) {
            param.cancelScheduledValues(start)
            param.setValueAtTime(map(resolved.toReal(first.value), project.bpm), start)
          }
          for (const sample of rest) {
            const when = sample.time + ctxOffset
            if (when > start) param.linearRampToValueAtTime(map(resolved.toReal(sample.value), project.bpm), when)
          }
        }
      }
    }
  }

  /** The AudioParams an automation target drives, with the map from its real value. */
  private automationBindings(
    track: Track,
    strip: Strip,
    target: string,
  ): { param: AudioParam; map: (real: number, bpm: number) => number }[] {
    const parsed = parseTarget(target)
    if (!parsed) return []
    if (parsed.kind === 'volume') return [{ param: strip.fader.gain, map: (v) => v }]
    if (parsed.kind === 'pan') return [{ param: strip.panner.pan, map: (v) => v }]
    const effect = track.effects.find((e) => e.id === parsed.effectId)
    if (!effect) return []
    return strip.chain
      .bindings(parsed.effectId, parsed.param)
      .map((b) => ({ param: b.param, map: (v: number, bpm: number) => b.map(v, effect.params, bpm) }))
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

  /**
   * Plays a note on a track's instrument at `when` (AudioContext time). A note scheduled late
   * starts late and is shortened by the same amount.
   */
  playNote(
    trackId: Id,
    instrument: Instrument,
    note: NoteToPlay,
    when: number,
    sample?: AudioBuffer,
    onEnded?: () => void,
  ): Voice | null {
    const strip = this.tracks.get(trackId)
    if (!strip) return null
    const late = Math.max(0, this.ctx.currentTime - when)
    if (late >= note.duration) return null
    const voice = playInstrumentNote(this.ctx, strip.input, instrument, { ...note, duration: note.duration - late }, when + late, sample)
    voice.onEnded = onEnded
    return voice
  }

  /** Plays a note event from the scheduler; the event's timeline time is mapped to `when`. */
  playNoteEvent(ev: NoteEvent, instrument: Instrument, when: number, sample?: AudioBuffer, onEnded?: () => void): Voice | null {
    return this.playNote(ev.trackId, instrument, ev, when, sample, onEnded)
  }

  dispose() {
    for (const strip of [...this.tracks.values(), ...this.buses.values()]) this.disconnect(strip)
    this.tracks.clear()
    this.buses.clear()
    this.masterChain.dispose()
    this.masterFader.disconnect()
    this.masterInput.disconnect()
  }

  private ensure(map: Map<Id, Strip>, id: Id): [Strip, boolean] {
    const existing = map.get(id)
    if (existing) return [existing, false]
    const ctx = this.ctx
    const audible = ctx.createGain()
    const strip: Strip = {
      input: ctx.createGain(),
      chain: new EffectChain(ctx),
      panner: ctx.createStereoPanner(),
      fader: ctx.createGain(),
      audible,
      out: ctx.createGain(),
      meter: new Meter(ctx, audible),
      routeTo: null,
      sends: new Map(),
    }
    strip.input.connect(strip.chain.input)
    strip.chain.output.connect(strip.panner).connect(strip.fader).connect(strip.audible).connect(strip.out)
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
    strip.input.disconnect()
    strip.chain.dispose()
    strip.fader.disconnect()
    strip.audible.disconnect()
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
        strip.audible.connect(node)
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
      // Drop ramps still scheduled (e.g. from automation that was just removed), then glide.
    param.cancelScheduledValues(this.ctx.currentTime)
    param.setTargetAtTime(value, this.ctx.currentTime, SMOOTHING)
    }
  }
}
