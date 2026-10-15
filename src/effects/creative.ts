// Effects batch 4, creative: crystal shimmer, tape echo (both AudioWorklets, creative.worklet.ts),
// sub booster, brass enhancer and vinyl, built from standard nodes.

import type { Effect } from '../model/types'
import { TAPE_ECHO_MAX, TAPE_ECHO_MIN } from './creative-dsp'
import { delaySeconds } from './definitions'
import { seedFromId, seededRandom } from './dsp'
import { dryWet, identity, instance, lfo, nyquistSafe, workletBindings, workletNode, type EffectInstance } from './parts'

type Builder = (ctx: BaseAudioContext, effect: Effect) => EffectInstance

const fraction = (percent: number) => percent / 100

/** A shaper curve over ±1 for `f`. */
function curve(f: (x: number) => number, size = 2048): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: size }, (_, i) => f((i / (size - 1)) * 2 - 1)) as Float32Array<ArrayBuffer>
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = Math.SQRT1_2) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = Math.min(freq, ctx.sampleRate / 2 - 100)
  f.Q.value = q
  return f
}

function crystal(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const node = workletNode(ctx, 'monkey-daw-crystal')
  dw.input.connect(node).connect(dw.wet)
  const bindings = { ...workletBindings(node, ['shift', 'splice', 'feedback']), mix: dw.mixBindings }
  return instance(ctx, { input: dw.input, output: dw.output, bindings: () => bindings, nodes: () => [...dw.nodes, node] })
}

function tapeEcho(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const node = workletNode(ctx, 'monkey-daw-tape-echo')
  dw.input.connect(node).connect(dw.wet)
  const bindings = { ...workletBindings(node, ['feedback', 'warp', 'shift']), mix: dw.mixBindings }
  if (node instanceof AudioWorkletNode) {
    // The worklet takes seconds: the synced note length, or the free time.
    const param = node.parameters.get('time')!
    const seconds = (ms: number, p: Effect['params'], bpm: number) =>
      Math.min(TAPE_ECHO_MAX, Math.max(TAPE_ECHO_MIN, delaySeconds({ ...p, time: ms }, bpm)))
    Object.assign(bindings, { time: [{ param, map: seconds }] })
  }
  return instance(ctx, { input: dw.input, output: dw.output, bindings: () => bindings, nodes: () => [...dw.nodes, node] })
}

/** The sub booster's harmonics: a hard tanh that makes the sub audible on small speakers. */
export const subCurve = () => curve((x) => Math.tanh(3 * x))

function subBoost(ctx: BaseAudioContext): EffectInstance {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const body = biquad(ctx, 'peaking', 55, 1.1)
  input.connect(body).connect(output)
  // Parallel: the lows driven into harmonics, then kept below 320 Hz so they stay a weight.
  const lows = biquad(ctx, 'lowpass', 88)
  const drive = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  shaper.curve = subCurve()
  shaper.oversample = '2x'
  const smooth = biquad(ctx, 'lowpass', 320)
  const level = ctx.createGain()
  input.connect(lows).connect(drive).connect(shaper).connect(smooth).connect(level).connect(output)
  const bindings = {
    freq: [
      { param: body.frequency, map: identity },
      { param: lows.frequency, map: (hz: number) => hz * 1.6 },
    ],
    body: [{ param: body.gain, map: (b: number) => fraction(b) * 9 }],
    drive: [
      { param: drive.gain, map: (d: number) => 1 + 6 * fraction(d) },
      { param: level.gain, map: (d: number) => fraction(d) * 0.35 },
    ],
  }
  return instance(ctx, {
    input,
    output,
    bindings: () => bindings,
    nodes: () => [input, body, lows, drive, shaper, smooth, level, output],
  })
}

/**
 * The brass enhancer's heat: tanh. The curve covers ±4 of input (it arrives divided by 4), so
 * driven peaks bend instead of hitting the curve's end.
 */
export const heatCurve = () => curve((u) => Math.tanh(4 * u))

function brass(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const body = biquad(ctx, 'peaking', 250, 0.8)
  const bite = biquad(ctx, 'peaking', 2500, 1.2)
  const heat = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  shaper.curve = heatCurve()
  shaper.oversample = '4x'
  const compensate = ctx.createGain()
  dw.input.connect(body).connect(bite).connect(heat).connect(shaper).connect(compensate).connect(dw.wet)
  const bindings = {
    body: [{ param: body.gain, map: identity }],
    bite: [{ param: bite.gain, map: identity }],
    heat: [
      // Drive in (divided by the curve's range of 4). Taking back the square root of it keeps
      // typical levels about the same: loud peaks flatten, quieter detail comes up.
      { param: heat.gain, map: (h: number) => (1 + 5 * fraction(h)) / 4 },
      { param: compensate.gain, map: (h: number) => 1 / Math.sqrt(1 + 5 * fraction(h)) },
    ],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, body, bite, heat, shaper, compensate],
  })
}

/** Seconds of record surface noise, looped. */
const SURFACE_SECONDS = 3

/** Surface noise: soft hiss with random crackles, about six a second. */
export function vinylSurface(sampleRate: number, seed: number): Float32Array {
  const random = seededRandom(seed)
  const data = new Float32Array(Math.round(SURFACE_SECONDS * sampleRate))
  for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * 0.15
  const crackles = Math.round(SURFACE_SECONDS * 6)
  for (let n = 0; n < crackles; n++) {
    const at = Math.floor(random() * data.length)
    const amp = (0.3 + 0.7 * random()) * (random() < 0.5 ? -1 : 1)
    const length = Math.round(sampleRate * (0.0005 + random() * 0.0015))
    for (let i = 0; i < length && at + i < data.length; i++) data[at + i] += amp * Math.exp(-i / (length / 4)) * (i % 2 ? -1 : 1)
  }
  return data
}

function vinyl(ctx: BaseAudioContext, effect: Effect): EffectInstance {
  const dw = dryWet(ctx)
  const delay = ctx.createDelay(0.05)
  delay.delayTime.value = 0.006
  const wow = lfo(ctx)
  wow.osc.frequency.value = 0.55
  const flutter = lfo(ctx)
  flutter.osc.frequency.value = 6
  wow.out.connect(delay.delayTime)
  flutter.out.connect(delay.delayTime)
  const lowCut = biquad(ctx, 'highpass', 40)
  const highCut = biquad(ctx, 'lowpass', 16000)
  dw.input.connect(delay).connect(lowCut).connect(highCut).connect(dw.wet)

  const buffer = ctx.createBuffer(1, Math.round(SURFACE_SECONDS * ctx.sampleRate), ctx.sampleRate)
  buffer.copyToChannel(vinylSurface(ctx.sampleRate, seedFromId(effect.id)) as Float32Array<ArrayBuffer>, 0)
  const surface = ctx.createBufferSource()
  surface.buffer = buffer
  surface.loop = true
  const surfaceTone = biquad(ctx, 'lowpass', 6000)
  const surfaceLevel = ctx.createGain()
  surface.connect(surfaceTone).connect(surfaceLevel).connect(dw.wet)
  surface.start()

  const hz = nyquistSafe(ctx)
  const bindings = {
    wear: [
      { param: lowCut.frequency, map: (w: number) => 40 + 260 * fraction(w) },
      { param: highCut.frequency, map: (w: number) => hz(16000 * (2500 / 16000) ** fraction(w)) },
    ],
    wobble: [
      { param: wow.out.gain, map: (w: number) => fraction(w) * 0.0045 },
      { param: flutter.out.gain, map: (w: number) => fraction(w) * 0.0006 },
    ],
    noise: [{ param: surfaceLevel.gain, map: (n: number) => fraction(n) * 0.12 }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, delay, lowCut, highCut, surface, surfaceTone, surfaceLevel, ...wow.nodes, ...flutter.nodes],
    dispose: () => {
      wow.stop()
      flutter.stop()
      try {
        surface.stop()
      } catch {
        // Already stopped.
      }
    },
  })
}

type CreativeType = 'crystal' | 'tapeEcho' | 'subBoost' | 'brass' | 'vinyl'

export const CREATIVE_BUILDERS: Record<CreativeType, Builder> = { crystal, tapeEcho, subBoost, brass, vinyl }
