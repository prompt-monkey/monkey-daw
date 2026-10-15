// Building blocks shared by every effect's audio graph: parameter bindings with smoothing, a
// dry/wet mix, a stereo input, LFOs, and the wrapper that turns an effect's parts into an
// EffectInstance.

import type { EffectParams } from '../model/types'
import { mixGains } from './dsp'

/** One AudioParam driven by an effect parameter. */
export interface Binding {
  param: AudioParam
  /** AudioParam value for a parameter value (given all params and the tempo, for synced times). */
  map: (value: number, params: EffectParams, bpm: number) => number
}

/** A window of timeline time being scheduled, mapped to the audio clock by `ctxOffset`. */
export interface ScheduleWindow {
  from: number
  to: number
  /** Starts fresh (play, seek, loop wrap): earlier scheduled values must be dropped. */
  catchUp: boolean
}

export interface EffectInstance {
  input: AudioNode
  output: AudioNode
  /**
   * Applies parameter values. `immediate` skips smoothing (offline renders, new nodes). Keys in
   * `automated` are left alone: automation drives them.
   */
  update: (params: EffectParams, bpm: number, immediate: boolean, automated?: ReadonlySet<string>) => void
  /** The AudioParams a parameter drives (empty if it can't be automated). */
  bindings: (key: string) => Binding[]
  /** Effects that move with the song position (sidechain duck) schedule themselves here. */
  schedule?: (window: ScheduleWindow, ctxOffset: number, params: EffectParams, bpm: number) => void
  /** What the effect is doing right now, for display (auto-tune's detected note). */
  monitor?: () => unknown
  dispose: () => void
}

const SMOOTHING = 0.015

export function setParam(ctx: BaseAudioContext, param: AudioParam, value: number, immediate: boolean) {
  if (immediate) {
    param.cancelScheduledValues(0)
    param.value = value
  } else {
    // Drop ramps still scheduled (e.g. from automation that was just removed), then glide.
    param.cancelScheduledValues(ctx.currentTime)
    param.setTargetAtTime(value, ctx.currentTime, SMOOTHING)
  }
}

export const disconnectAll = (nodes: AudioNode[]) => nodes.forEach((node) => node.disconnect())

/** Keeps frequencies just below Nyquist, where filters stop being valid. */
export const nyquistSafe = (ctx: BaseAudioContext) => (hz: number) => Math.min(hz, ctx.sampleRate / 2 - 100)
export const identity = (v: number) => v

/** A gain node that turns mono input into two channels, for effects that work per side. */
export function stereoInput(ctx: BaseAudioContext): GainNode {
  const node = ctx.createGain()
  node.channelCount = 2
  node.channelCountMode = 'explicit'
  node.channelInterpretation = 'speakers'
  return node
}

/**
 * Input split into a dry path and a wet path, summed at the output with an equal-power mix.
 * `stereo` makes mono input two-channel, for effects that treat the sides differently.
 */
export function dryWet(ctx: BaseAudioContext, stereo = false) {
  const input = stereo ? stereoInput(ctx) : ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const output = ctx.createGain()
  input.connect(dry).connect(output)
  wet.connect(output)
  return {
    input,
    output,
    /** Connect the end of the wet chain here. */
    wet,
    mixBindings: [
      { param: dry.gain, map: (percent: number) => mixGains(percent / 100).dry },
      { param: wet.gain, map: (percent: number) => mixGains(percent / 100).wet },
    ] as Binding[],
    nodes: [input, dry, wet, output] as AudioNode[],
  }
}

/** An AudioWorklet node, or a pass-through gain if the worklet couldn't load. */
export function workletNode(ctx: BaseAudioContext, name: string): AudioWorkletNode | GainNode {
  try {
    return new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  } catch {
    return ctx.createGain()
  }
}

/** Bindings for worklet parameters with the same names as the effect's parameters. */
export function workletBindings(node: AudioWorkletNode | GainNode, keys: string[]): Record<string, Binding[]> {
  const out: Record<string, Binding[]> = {}
  if (!(node instanceof AudioWorkletNode)) return out
  for (const key of keys) {
    const param = node.parameters.get(key)
    if (param) out[key] = [{ param, map: identity }]
  }
  return out
}

/** A running oscillator feeding a gain: connect `out` to the AudioParams it should move. */
export function lfo(ctx: BaseAudioContext, type: OscillatorType = 'sine') {
  const osc = ctx.createOscillator()
  osc.type = type
  const out = ctx.createGain()
  osc.connect(out)
  osc.start()
  return {
    osc,
    out,
    nodes: [osc, out] as AudioNode[],
    stop: () => {
      try {
        osc.stop()
      } catch {
        // Already stopped.
      }
    },
  }
}

export interface Parts {
  input: AudioNode
  output: AudioNode
  bindings: () => Record<string, Binding[]>
  /** Non-numeric or structural changes (filter type, ping-pong, impulse, curve). */
  configure?: (params: EffectParams, bpm: number) => boolean | void
  schedule?: EffectInstance['schedule']
  monitor?: EffectInstance['monitor']
  nodes: () => AudioNode[]
  /** Extra cleanup (stopping oscillators). */
  dispose?: () => void
}

/** Turns an effect's parts into an EffectInstance with the shared update logic. */
export function instance(ctx: BaseAudioContext, parts: Parts): EffectInstance {
  return {
    input: parts.input,
    output: parts.output,
    update(params, bpm, immediate, automated) {
      // A structural rebuild creates fresh nodes, which take their values immediately.
      const rebuilt = parts.configure?.(params, bpm) === true
      for (const [key, bindings] of Object.entries(parts.bindings())) {
        if (automated?.has(key)) continue
        const value = params[key] as number
        for (const b of bindings) setParam(ctx, b.param, b.map(value, params, bpm), immediate || rebuilt)
      }
    },
    bindings: (key) => parts.bindings()[key] ?? [],
    schedule: parts.schedule,
    monitor: parts.monitor,
    dispose: () => {
      parts.dispose?.()
      disconnectAll(parts.nodes())
    },
  }
}
