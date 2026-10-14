// Audio node implementations of the effects. Each effect is a small sub-graph with one input and
// one output, built on any BaseAudioContext so live playback and offline export match.
//
// Every numeric parameter is described by bindings: which AudioParams it drives and how its
// value maps onto them. Normal updates and automation both go through the same bindings.

import type { Effect, EffectParams } from '../model/types'
import { delaySeconds } from './definitions'
import { dbToGain, mixGains, reverbImpulse, saturationCurve, seedFromId } from './dsp'
import gateWorkletUrl from './gate.worklet.ts?worker&url'

/** One AudioParam driven by an effect parameter. */
export interface Binding {
  param: AudioParam
  /** AudioParam value for a parameter value (given all params and the tempo, for synced times). */
  map: (value: number, params: EffectParams, bpm: number) => number
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
  dispose: () => void
}

const SMOOTHING = 0.015
const MAX_DELAY = 3
/** Frames Web Audio processes at a time; feedback loops add this much delay. */
const RENDER_QUANTUM = 128

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()

/** Loads the effects' AudioWorklets into a context. Must finish before building effect graphs. */
export function ensureEffectWorklets(ctx: BaseAudioContext): Promise<void> {
  let promise = loaded.get(ctx)
  if (!promise) {
    promise = ctx.audioWorklet.addModule(gateWorkletUrl).catch((err) => {
      console.warn('Gate effect unavailable', err)
    })
    loaded.set(ctx, promise)
  }
  return promise
}

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

const disconnectAll = (nodes: AudioNode[]) => nodes.forEach((node) => node.disconnect())

/** Keeps frequencies just below Nyquist, where filters stop being valid. */
const nyquistSafe = (ctx: BaseAudioContext) => (hz: number) => Math.min(hz, ctx.sampleRate / 2 - 100)
const identity = (v: number) => v

/** Input split into a dry path and a wet path, summed at the output with an equal-power mix. */
function dryWet(ctx: BaseAudioContext) {
  const input = ctx.createGain()
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

interface Parts {
  input: AudioNode
  output: AudioNode
  bindings: () => Record<string, Binding[]>
  /** Non-numeric or structural changes (filter type, ping-pong, impulse, curve). */
  configure?: (params: EffectParams, bpm: number) => boolean | void
  nodes: () => AudioNode[]
}

/** Turns an effect's parts into an EffectInstance with the shared update logic. */
function instance(ctx: BaseAudioContext, parts: Parts): EffectInstance {
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
    dispose: () => disconnectAll(parts.nodes()),
  }
}

function eq(ctx: BaseAudioContext): EffectInstance {
  const make = (type: BiquadFilterType) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    return f
  }
  const lowCut = make('highpass')
  const low = make('lowshelf')
  const mid = make('peaking')
  const high = make('highshelf')
  const highCut = make('lowpass')
  lowCut.Q.value = highCut.Q.value = Math.SQRT1_2
  lowCut.connect(low).connect(mid).connect(high).connect(highCut)
  const hz = nyquistSafe(ctx)
  const bindings = {
    lowCut: [{ param: lowCut.frequency, map: hz }],
    lowFreq: [{ param: low.frequency, map: identity }],
    lowGain: [{ param: low.gain, map: identity }],
    midFreq: [{ param: mid.frequency, map: identity }],
    midGain: [{ param: mid.gain, map: identity }],
    midQ: [{ param: mid.Q, map: identity }],
    highFreq: [{ param: high.frequency, map: hz }],
    highGain: [{ param: high.gain, map: identity }],
    // At the top of its range the high cut opens fully (to just below Nyquist).
    highCut: [{ param: highCut.frequency, map: hz }],
  }
  return instance(ctx, {
    input: lowCut,
    output: highCut,
    bindings: () => bindings,
    nodes: () => [lowCut, low, mid, high, highCut],
  })
}

function compressor(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const comp = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()
  dw.input.connect(comp).connect(makeup).connect(dw.wet)
  const bindings = {
    threshold: [{ param: comp.threshold, map: identity }],
    ratio: [{ param: comp.ratio, map: identity }],
    knee: [{ param: comp.knee, map: identity }],
    attack: [{ param: comp.attack, map: (ms: number) => ms / 1000 }],
    release: [{ param: comp.release, map: (ms: number) => ms / 1000 }],
    makeup: [{ param: makeup.gain, map: dbToGain }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, comp, makeup],
  })
}

function filter(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const biquad = ctx.createBiquadFilter()
  dw.input.connect(biquad).connect(dw.wet)
  const bindings = {
    cutoff: [{ param: biquad.frequency, map: nyquistSafe(ctx) }],
    resonance: [{ param: biquad.Q, map: identity }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    configure: (p) => {
      biquad.type = p.mode as BiquadFilterType
    },
    nodes: () => [...dw.nodes, biquad],
  })
}

function delay(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  // The echo network hangs off this node, so it can be rebuilt without touching the dry path.
  const send = ctx.createGain()
  dw.input.connect(send)
  // Web Audio delays any feedback loop by one render block (128 frames). The looping delay is
  // shortened by that much so repeats land on time; a fixed block of pre-delay keeps the first
  // echo on time too.
  const block = RENDER_QUANTUM / ctx.sampleRate
  // `ms` is the free time being applied (it may be automated); a synced division overrides it.
  const fullTime = (ms: number, p: EffectParams, bpm: number) => Math.min(MAX_DELAY, delaySeconds({ ...p, time: ms }, bpm))
  const loopTime = (v: number, p: EffectParams, bpm: number) => Math.max(block, fullTime(v, p, bpm) - block)
  const hz = nyquistSafe(ctx)
  let network: { nodes: AudioNode[]; bindings: Record<string, Binding[]> } | null = null
  let pingPong: boolean | null = null

  const delayLine = () => {
    const d = ctx.createDelay(MAX_DELAY)
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    return { d, tone }
  }

  const build = (ping: boolean) => {
    if (network) disconnectAll(network.nodes)
    send.disconnect()
    if (!ping) {
      const a = delayLine()
      const pre = ctx.createDelay(1)
      pre.delayTime.value = block
      const feedback = ctx.createGain()
      send.connect(pre).connect(a.d).connect(a.tone).connect(dw.wet)
      a.tone.connect(feedback).connect(a.d)
      network = {
        nodes: [pre, a.d, a.tone, feedback],
        bindings: {
          time: [{ param: a.d.delayTime, map: loopTime }],
          tone: [{ param: a.tone.frequency, map: hz }],
          feedback: [{ param: feedback.gain, map: (v: number) => v / 100 }],
        },
      }
    } else {
      // Mono sum into the left line; echoes alternate left, right, left…
      const sum = ctx.createGain()
      sum.channelCount = 1
      sum.channelCountMode = 'explicit'
      sum.channelInterpretation = 'speakers'
      const l = delayLine()
      const r = delayLine()
      const crossLR = ctx.createGain()
      const crossRL = ctx.createGain()
      const merger = ctx.createChannelMerger(2)
      send.connect(sum).connect(l.d)
      l.d.connect(l.tone)
      r.d.connect(r.tone)
      l.tone.connect(merger, 0, 0)
      r.tone.connect(merger, 0, 1)
      // The first left→right hop is the second echo, so it always passes; feedback sets the rest.
      l.tone.connect(crossLR).connect(r.d)
      r.tone.connect(crossRL).connect(l.d)
      merger.connect(dw.wet)
      network = {
        nodes: [sum, l.d, l.tone, r.d, r.tone, crossLR, crossRL, merger],
        bindings: {
          // The loop's extra block falls on the left→right hop, so only the right line is shortened.
          time: [
            { param: l.d.delayTime, map: fullTime },
            { param: r.d.delayTime, map: loopTime },
          ],
          tone: [
            { param: l.tone.frequency, map: hz },
            { param: r.tone.frequency, map: hz },
          ],
          feedback: [{ param: crossRL.gain, map: (v: number) => v / 100 }],
        },
      }
    }
    pingPong = ping
  }

  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => ({ ...network!.bindings, mix: dw.mixBindings }),
    configure: (p) => {
      const ping = p.pingPong === true
      if (ping === pingPong) return false
      build(ping)
      return true
    },
    nodes: () => [...dw.nodes, send, ...(network?.nodes ?? [])],
  })
}

function reverb(ctx: BaseAudioContext, effect: Effect): EffectInstance {
  const dw = dryWet(ctx)
  const preDelay = ctx.createDelay(0.25)
  const convolver = ctx.createConvolver()
  const damping = ctx.createBiquadFilter()
  damping.type = 'lowpass'
  dw.input.connect(preDelay).connect(convolver).connect(damping).connect(dw.wet)
  const seed = seedFromId(effect.id)
  let decay: number | null = null
  const bindings = {
    preDelay: [{ param: preDelay.delayTime, map: (ms: number) => ms / 1000 }],
    damping: [{ param: damping.frequency, map: nyquistSafe(ctx) }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    configure: (p) => {
      if (p.decay === decay) return
      decay = p.decay as number
      const channels = reverbImpulse(ctx.sampleRate, decay, seed)
      const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate)
      channels.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i))
      convolver.buffer = buffer
    },
    nodes: () => [...dw.nodes, preDelay, convolver, damping],
  })
}

function saturation(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const shaper = ctx.createWaveShaper()
  shaper.oversample = '4x'
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  const output = ctx.createGain()
  dw.input.connect(shaper).connect(tone).connect(output).connect(dw.wet)
  let drive: number | null = null
  const bindings = {
    tone: [{ param: tone.frequency, map: nyquistSafe(ctx) }],
    output: [{ param: output.gain, map: dbToGain }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    configure: (p) => {
      if (p.drive === drive) return
      drive = p.drive as number
      shaper.curve = saturationCurve(drive) as Float32Array<ArrayBuffer>
    },
    nodes: () => [...dw.nodes, shaper, tone, output],
  })
}

function gate(ctx: BaseAudioContext): EffectInstance {
  let node: AudioWorkletNode | GainNode
  try {
    node = new AudioWorkletNode(ctx, 'monkey-daw-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  } catch {
    // Worklet not loaded: pass the signal through unchanged rather than breaking the chain.
    node = ctx.createGain()
  }
  const bindings: Record<string, Binding[]> = {}
  if (node instanceof AudioWorkletNode) {
    for (const key of ['threshold', 'attack', 'release', 'range']) {
      const param = node.parameters.get(key)
      if (param) bindings[key] = [{ param, map: identity }]
    }
  }
  return instance(ctx, {
    input: node,
    output: node,
    bindings: () => bindings,
    nodes: () => [node],
  })
}

const BUILDERS: Record<Effect['type'], (ctx: BaseAudioContext, effect: Effect) => EffectInstance> = {
  eq,
  compressor,
  filter,
  delay,
  reverb,
  saturation,
  gate,
}

export function createEffectInstance(ctx: BaseAudioContext, effect: Effect): EffectInstance {
  return BUILDERS[effect.type](ctx, effect)
}
