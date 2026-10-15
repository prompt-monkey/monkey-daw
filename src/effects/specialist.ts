// Effects batch 3, specialist: dynamics and pitch processors that run in an AudioWorklet
// (specialist.worklet.ts), and the amp/cabinet, built from standard nodes.

import type { Effect } from '../model/types'
import { dbToGain } from './dsp'
import { SCALE_KEYS } from './specialist-dsp'
import { dryWet, identity, instance, nyquistSafe, type Binding, type EffectInstance } from './parts'

type Builder = (ctx: BaseAudioContext, effect: Effect) => EffectInstance

/** An AudioWorklet node, or a pass-through gain if the worklet couldn't load. */
function workletNode(ctx: BaseAudioContext, name: string): AudioWorkletNode | GainNode {
  try {
    return new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  } catch {
    return ctx.createGain()
  }
}

/** Bindings for worklet parameters with the same names as the effect's parameters. */
function workletBindings(node: AudioWorkletNode | GainNode, keys: string[]): Record<string, Binding[]> {
  const out: Record<string, Binding[]> = {}
  if (!(node instanceof AudioWorkletNode)) return out
  for (const key of keys) {
    const param = node.parameters.get(key)
    if (param) out[key] = [{ param, map: identity }]
  }
  return out
}

function transient(ctx: BaseAudioContext): EffectInstance {
  const node = workletNode(ctx, 'monkey-daw-transient')
  const output = ctx.createGain()
  node.connect(output)
  const bindings = { ...workletBindings(node, ['attack', 'sustain']), output: [{ param: output.gain, map: dbToGain }] }
  return instance(ctx, { input: node, output, bindings: () => bindings, nodes: () => [node, output] })
}

function deesser(ctx: BaseAudioContext): EffectInstance {
  const node = workletNode(ctx, 'monkey-daw-deesser')
  const bindings = workletBindings(node, ['freq', 'threshold', 'range'])
  if (bindings.freq) bindings.freq = [{ param: bindings.freq[0].param, map: nyquistSafe(ctx) }]
  return instance(ctx, { input: node, output: node, bindings: () => bindings, nodes: () => [node] })
}

function opto(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const node = workletNode(ctx, 'monkey-daw-opto')
  const makeup = ctx.createGain()
  dw.input.connect(node).connect(makeup).connect(dw.wet)
  const bindings = {
    ...workletBindings(node, ['peakReduction']),
    gain: [{ param: makeup.gain, map: dbToGain }],
    mix: dw.mixBindings,
  }
  return instance(ctx, { input: dw.input, output: dw.output, bindings: () => bindings, nodes: () => [...dw.nodes, node, makeup] })
}

function doubler(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const node = workletNode(ctx, 'monkey-daw-doubler')
  dw.input.connect(node).connect(dw.wet)
  const bindings = { ...workletBindings(node, ['octave', 'detune', 'spread']), mix: dw.mixBindings }
  return instance(ctx, { input: dw.input, output: dw.output, bindings: () => bindings, nodes: () => [...dw.nodes, node] })
}

/**
 * Tube-like drive curve over ±1: asymmetric (it bends earlier on one side), which adds the
 * even harmonics amps are known for. Drive itself is the gain in front of it.
 */
export function ampCurve(size = 4096): Float32Array {
  const bias = 0.2
  const shape = (x: number) => Math.tanh(2.5 * (x + bias)) - Math.tanh(2.5 * bias)
  const peak = Math.max(Math.abs(shape(1)), Math.abs(shape(-1)))
  return Float32Array.from({ length: size }, (_, i) => shape((i / (size - 1)) * 2 - 1) / peak)
}

/** Filters that give a speaker cabinet its voice: low thump, upper-mid bite, no fizz. */
const CABINETS: Record<string, { type: BiquadFilterType; freq: number; q: number; gain?: number }[]> = {
  '1x12': [
    { type: 'highpass', freq: 90, q: 0.7 },
    { type: 'peaking', freq: 110, q: 1.2, gain: 3 },
    { type: 'peaking', freq: 2400, q: 1.5, gain: 3 },
    { type: 'lowpass', freq: 5200, q: 0.8 },
    { type: 'lowpass', freq: 6500, q: 0.7 },
  ],
  '4x12': [
    { type: 'highpass', freq: 75, q: 0.7 },
    { type: 'peaking', freq: 95, q: 1.4, gain: 4 },
    { type: 'peaking', freq: 600, q: 1, gain: -2 },
    { type: 'peaking', freq: 2000, q: 1.2, gain: 2.5 },
    { type: 'lowpass', freq: 4200, q: 0.9 },
    { type: 'lowpass', freq: 5500, q: 0.7 },
  ],
}

function amp(ctx: BaseAudioContext): EffectInstance {
  // Input low-cut keeps the drive from getting muddy, as on a real amp's input stage.
  const input = ctx.createBiquadFilter()
  input.type = 'highpass'
  input.frequency.value = 70
  const drive = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  shaper.curve = ampCurve() as Float32Array<ArrayBuffer>
  shaper.oversample = '4x'
  const bass = ctx.createBiquadFilter()
  bass.type = 'lowshelf'
  bass.frequency.value = 120
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 700
  mid.Q.value = 0.8
  const treble = ctx.createBiquadFilter()
  treble.type = 'highshelf'
  treble.frequency.value = 3000
  const output = ctx.createGain()
  input.connect(drive).connect(shaper).connect(bass).connect(mid).connect(treble)
  let cabinet: BiquadFilterNode[] = []
  let model: string | null = null

  const bindings = {
    drive: [{ param: drive.gain, map: dbToGain }],
    bass: [{ param: bass.gain, map: identity }],
    mid: [{ param: mid.gain, map: identity }],
    treble: [{ param: treble.gain, map: identity }],
    output: [{ param: output.gain, map: dbToGain }],
  }
  return instance(ctx, {
    input,
    output,
    bindings: () => bindings,
    configure: (p) => {
      if (p.cabinet === model) return
      model = p.cabinet as string
      treble.disconnect()
      cabinet.forEach((f) => f.disconnect())
      cabinet = (CABINETS[model] ?? []).map((spec) => {
        const f = ctx.createBiquadFilter()
        f.type = spec.type
        f.frequency.value = Math.min(spec.freq, ctx.sampleRate / 2 - 100)
        f.Q.value = spec.q
        if (spec.gain !== undefined) f.gain.value = spec.gain
        return f
      })
      // treble → cabinet filters → output (straight to the output with no cabinet).
      cabinet.reduce<AudioNode>((a, b) => a.connect(b), treble).connect(output)
    },
    nodes: () => [input, drive, shaper, bass, mid, treble, ...cabinet, output],
  })
}

function autotune(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const node = workletNode(ctx, 'monkey-daw-autotune')
  dw.input.connect(node).connect(dw.wet)
  const bindings = { ...workletBindings(node, ['retune', 'amount']), mix: dw.mixBindings }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    // Key and scale are choices; the worklet takes them as numbers.
    configure: (p) => {
      if (!(node instanceof AudioWorkletNode)) return
      node.parameters.get('key')?.setValueAtTime(Number(p.key), ctx.currentTime)
      node.parameters.get('scale')?.setValueAtTime(Math.max(0, SCALE_KEYS.indexOf(p.scale as string)), ctx.currentTime)
    },
    nodes: () => [...dw.nodes, node],
  })
}

type SpecialistType = 'transient' | 'deesser' | 'opto' | 'doubler' | 'amp' | 'autotune'

export const SPECIALIST_BUILDERS: Record<SpecialistType, Builder> = { transient, deesser, opto, doubler, amp, autotune }
