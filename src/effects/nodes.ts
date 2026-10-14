// Audio node implementations of the effects. Each effect is a small sub-graph with one input and
// one output, built on any BaseAudioContext so live playback and offline export match.

import type { Effect, EffectParams } from '../model/types'
import { delaySeconds } from './definitions'
import { dbToGain, mixGains, reverbImpulse, saturationCurve, seedFromId } from './dsp'
import gateWorkletUrl from './gate.worklet.ts?worker&url'

export interface EffectInstance {
  input: AudioNode
  output: AudioNode
  /** Applies new parameter values; `immediate` skips smoothing (offline renders, new nodes). */
  update: (params: EffectParams, bpm: number, immediate: boolean) => void
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

function setParam(ctx: BaseAudioContext, param: AudioParam, value: number, immediate: boolean) {
  if (immediate) {
    param.cancelScheduledValues(0)
    param.value = value
  } else {
    param.setTargetAtTime(value, ctx.currentTime, SMOOTHING)
  }
}

const n = (params: EffectParams, key: string) => params[key] as number

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
    setMix(percent: number, immediate: boolean) {
      const g = mixGains(percent / 100)
      setParam(ctx, dry.gain, g.dry, immediate)
      setParam(ctx, wet.gain, g.wet, immediate)
    },
    nodes: [input, dry, wet, output] as AudioNode[],
  }
}

const disconnectAll = (nodes: AudioNode[]) => nodes.forEach((node) => node.disconnect())

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
  return {
    input: lowCut,
    output: highCut,
    update(p, _bpm, now) {
      setParam(ctx, lowCut.frequency, n(p, 'lowCut'), now)
      setParam(ctx, low.frequency, n(p, 'lowFreq'), now)
      setParam(ctx, low.gain, n(p, 'lowGain'), now)
      setParam(ctx, mid.frequency, n(p, 'midFreq'), now)
      setParam(ctx, mid.gain, n(p, 'midGain'), now)
      setParam(ctx, mid.Q, n(p, 'midQ'), now)
      setParam(ctx, high.frequency, n(p, 'highFreq'), now)
      setParam(ctx, high.gain, n(p, 'highGain'), now)
      // At the top of its range the high cut opens fully (to just below Nyquist).
      setParam(ctx, highCut.frequency, Math.min(n(p, 'highCut'), ctx.sampleRate / 2 - 100), now)
    },
    dispose: () => disconnectAll([lowCut, low, mid, high, highCut]),
  }
}

function compressor(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const comp = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()
  dw.input.connect(comp).connect(makeup).connect(dw.wet)
  return {
    input: dw.input,
    output: dw.output,
    update(p, _bpm, now) {
      setParam(ctx, comp.threshold, n(p, 'threshold'), now)
      setParam(ctx, comp.ratio, n(p, 'ratio'), now)
      setParam(ctx, comp.knee, n(p, 'knee'), now)
      setParam(ctx, comp.attack, n(p, 'attack') / 1000, now)
      setParam(ctx, comp.release, n(p, 'release') / 1000, now)
      setParam(ctx, makeup.gain, dbToGain(n(p, 'makeup')), now)
      dw.setMix(n(p, 'mix'), now)
    },
    dispose: () => disconnectAll([...dw.nodes, comp, makeup]),
  }
}

function filter(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const biquad = ctx.createBiquadFilter()
  dw.input.connect(biquad).connect(dw.wet)
  return {
    input: dw.input,
    output: dw.output,
    update(p, _bpm, now) {
      biquad.type = p.mode as BiquadFilterType
      setParam(ctx, biquad.frequency, Math.min(n(p, 'cutoff'), ctx.sampleRate / 2 - 100), now)
      setParam(ctx, biquad.Q, n(p, 'resonance'), now)
      dw.setMix(n(p, 'mix'), now)
    },
    dispose: () => disconnectAll([...dw.nodes, biquad]),
  }
}

function delay(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  // The echo network hangs off this node, so it can be rebuilt without touching the dry path.
  const send = ctx.createGain()
  dw.input.connect(send)
  let network: { nodes: AudioNode[]; update: (p: EffectParams, bpm: number, now: boolean) => void } | null = null
  let pingPong: boolean | null = null

  const delayLine = () => {
    const d = ctx.createDelay(MAX_DELAY)
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    return { d, tone }
  }

  // Web Audio delays any feedback loop by one render block (128 frames). The looping delay is
  // shortened by that much so repeats land on time; a fixed block of pre-delay keeps the first
  // echo on time too.
  const block = RENDER_QUANTUM / ctx.sampleRate
  const loopTime = (p: EffectParams, bpm: number) => Math.max(block, Math.min(MAX_DELAY, delaySeconds(p, bpm)) - block)

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
        update(p, bpm, now) {
          setParam(ctx, a.d.delayTime, loopTime(p, bpm), now)
          setParam(ctx, a.tone.frequency, Math.min(n(p, 'tone'), ctx.sampleRate / 2 - 100), now)
          setParam(ctx, feedback.gain, n(p, 'feedback') / 100, now)
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
      l.tone.connect(crossLR).connect(r.d)
      r.tone.connect(crossRL).connect(l.d)
      merger.connect(dw.wet)
      network = {
        nodes: [sum, l.d, l.tone, r.d, r.tone, crossLR, crossRL, merger],
        update(p, bpm, now) {
          // The loop's extra block falls on the left→right hop, so only the right line is shortened.
          setParam(ctx, l.d.delayTime, Math.min(MAX_DELAY, delaySeconds(p, bpm)), now)
          setParam(ctx, r.d.delayTime, loopTime(p, bpm), now)
          for (const line of [l, r]) {
            setParam(ctx, line.tone.frequency, Math.min(n(p, 'tone'), ctx.sampleRate / 2 - 100), now)
          }
          // The first left→right hop is the second echo, so it always passes; feedback sets the rest.
          setParam(ctx, crossLR.gain, 1, now)
          setParam(ctx, crossRL.gain, n(p, 'feedback') / 100, now)
        },
      }
    }
    pingPong = ping
  }

  return {
    input: dw.input,
    output: dw.output,
    update(p, bpm, now) {
      const ping = p.pingPong === true
      if (ping !== pingPong) {
        build(ping)
        now = true
      }
      network!.update(p, bpm, now)
      dw.setMix(n(p, 'mix'), now)
    },
    dispose: () => disconnectAll([...dw.nodes, send, ...(network?.nodes ?? [])]),
  }
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
  return {
    input: dw.input,
    output: dw.output,
    update(p, _bpm, now) {
      if (n(p, 'decay') !== decay) {
        decay = n(p, 'decay')
        const channels = reverbImpulse(ctx.sampleRate, decay, seed)
        const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate)
        channels.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i))
        convolver.buffer = buffer
      }
      setParam(ctx, preDelay.delayTime, n(p, 'preDelay') / 1000, now)
      setParam(ctx, damping.frequency, Math.min(n(p, 'damping'), ctx.sampleRate / 2 - 100), now)
      dw.setMix(n(p, 'mix'), now)
    },
    dispose: () => disconnectAll([...dw.nodes, preDelay, convolver, damping]),
  }
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
  return {
    input: dw.input,
    output: dw.output,
    update(p, _bpm, now) {
      if (n(p, 'drive') !== drive) {
        drive = n(p, 'drive')
        shaper.curve = saturationCurve(drive) as Float32Array<ArrayBuffer>
      }
      setParam(ctx, tone.frequency, Math.min(n(p, 'tone'), ctx.sampleRate / 2 - 100), now)
      setParam(ctx, output.gain, dbToGain(n(p, 'output')), now)
      dw.setMix(n(p, 'mix'), now)
    },
    dispose: () => disconnectAll([...dw.nodes, shaper, tone, output]),
  }
}

function gate(ctx: BaseAudioContext): EffectInstance {
  let node: AudioWorkletNode | GainNode
  try {
    node = new AudioWorkletNode(ctx, 'monkey-daw-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  } catch {
    // Worklet not loaded: pass the signal through unchanged rather than breaking the chain.
    node = ctx.createGain()
  }
  return {
    input: node,
    output: node,
    update(p, _bpm, now) {
      if (!(node instanceof AudioWorkletNode)) return
      for (const key of ['threshold', 'attack', 'release', 'range']) {
        const param = node.parameters.get(key)
        if (param) setParam(ctx, param, n(p, key), now)
      }
    },
    dispose: () => node.disconnect(),
  }
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
