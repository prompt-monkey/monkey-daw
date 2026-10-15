// Effects batch 2, character and space: modulation, lo-fi, tone shaping, stereo and space. Each is
// a small graph of built-in nodes (the bitcrusher uses an AudioWorklet), like batch 1.

import type { Effect } from '../model/types'
import { duckInterval, duckShape, lfoRate } from './definitions'
import { DUCK_ATTACK, dbToGain, duckGain, duckPulses, plateImpulse, saturationCurve, seedFromId, seededRandom, softClipCurve } from './dsp'
import { disconnectAll, dryWet, identity, instance, lfo, nyquistSafe, stereoInput, type Binding, type EffectInstance } from './parts'

type Builder = (ctx: BaseAudioContext, effect: Effect) => EffectInstance

const toSeconds = (ms: number) => ms / 1000
const fraction = (percent: number) => percent / 100

function splitStereo(ctx: BaseAudioContext) {
  return { split: ctx.createChannelSplitter(2), merge: ctx.createChannelMerger(2) }
}

/** Largest delay swing of the chorus, in seconds. */
const CHORUS_SWING = 0.004

function chorus(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx, true)
  const { split, merge } = splitStereo(ctx)
  const left = ctx.createDelay(0.1)
  const right = ctx.createDelay(0.1)
  const mod = lfo(ctx)
  // The right side's swing: the same as the left at no width, the opposite at full width.
  const rightSwing = ctx.createGain()
  dw.input.connect(split)
  split.connect(left, 0)
  split.connect(right, 1)
  left.connect(merge, 0, 0)
  right.connect(merge, 0, 1)
  merge.connect(dw.wet)
  mod.out.connect(left.delayTime)
  mod.osc.connect(rightSwing).connect(right.delayTime)
  const swing = (depth: number, width: number) => fraction(depth) * CHORUS_SWING * (1 - 2 * fraction(width))
  const bindings = {
    rate: [{ param: mod.osc.frequency, map: identity }],
    depth: [
      { param: mod.out.gain, map: (d: number) => fraction(d) * CHORUS_SWING },
      { param: rightSwing.gain, map: (d: number, p) => swing(d, p.width as number) },
    ] as Binding[],
    width: [{ param: rightSwing.gain, map: (w: number, p) => swing(p.depth as number, w) }] as Binding[],
    delay: [
      { param: left.delayTime, map: toSeconds },
      { param: right.delayTime, map: toSeconds },
    ],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, split, merge, left, right, rightSwing, ...mod.nodes],
    dispose: mod.stop,
  })
}

function phaser(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  // The swept network hangs off this node, so switching type doesn't touch the dry path.
  const send = ctx.createGain()
  dw.input.connect(send)
  const mod = lfo(ctx)
  let network: { nodes: AudioNode[]; bindings: Record<string, Binding[]> } | null = null
  let mode: string | null = null

  const build = (type: string) => {
    if (network) disconnectAll(network.nodes)
    send.disconnect()
    mod.out.disconnect()
    const feedback = ctx.createGain()
    if (type === 'phaser') {
      // Four all-pass stages swept around 900 Hz make the moving notches.
      const stages = Array.from({ length: 4 }, () => {
        const f = ctx.createBiquadFilter()
        f.type = 'allpass'
        f.frequency.value = 900
        f.Q.value = 0.7
        mod.out.connect(f.frequency)
        return f
      })
      send.connect(stages[0])
      stages.reduce((a, b) => (a.connect(b), b))
      stages[3].connect(dw.wet)
      stages[3].connect(feedback).connect(stages[0])
      network = {
        nodes: [...stages, feedback],
        bindings: {
          depth: [{ param: mod.out.gain, map: (d: number) => fraction(d) * 700 }],
          feedback: [{ param: feedback.gain, map: fraction }],
        },
      }
    } else {
      // A very short delay swept between about 0.5 and 5.5 ms, fed back on itself.
      const delay = ctx.createDelay(0.02)
      delay.delayTime.value = 0.003
      send.connect(delay).connect(dw.wet)
      delay.connect(feedback).connect(delay)
      mod.out.connect(delay.delayTime)
      network = {
        nodes: [delay, feedback],
        bindings: {
          depth: [{ param: mod.out.gain, map: (d: number) => fraction(d) * 0.0025 }],
          feedback: [{ param: feedback.gain, map: fraction }],
        },
      }
    }
    mode = type
  }

  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => ({ ...network!.bindings, rate: [{ param: mod.osc.frequency, map: identity }], mix: dw.mixBindings }),
    configure: (p) => {
      if (p.mode === mode) return false
      build(p.mode as string)
      return true
    },
    nodes: () => [...dw.nodes, send, ...mod.nodes, ...(network?.nodes ?? [])],
    dispose: mod.stop,
  })
}

function tremolo(ctx: BaseAudioContext): EffectInstance {
  const amp = ctx.createGain()
  const pan = ctx.createStereoPanner()
  amp.connect(pan)
  const mod = lfo(ctx)
  const ampSwing = ctx.createGain()
  const panSwing = ctx.createGain()
  mod.osc.connect(ampSwing).connect(amp.gain)
  mod.osc.connect(panSwing).connect(pan.pan)
  let mode: string | null = null
  const isTremolo = (p: Effect['params']) => p.mode !== 'autopan'
  const bindings = {
    rate: [{ param: mod.osc.frequency, map: (hz: number, p, bpm) => lfoRate({ ...p, rate: hz }, bpm) }] as Binding[],
    // Tremolo swings the level between 1 and 1 − depth; auto-pan swings the pan by ±depth.
    depth: [
      { param: amp.gain, map: (d: number, p) => (isTremolo(p) ? 1 - fraction(d) / 2 : 1) },
      { param: ampSwing.gain, map: (d: number, p) => (isTremolo(p) ? fraction(d) / 2 : 0) },
      { param: panSwing.gain, map: (d: number, p) => (isTremolo(p) ? 0 : fraction(d)) },
    ] as Binding[],
  }
  return instance(ctx, {
    input: amp,
    output: pan,
    bindings: () => bindings,
    configure: (p) => {
      mod.osc.type = p.shape as OscillatorType
      const changed = p.mode !== mode
      mode = p.mode as string
      return changed
    },
    nodes: () => [amp, pan, ampSwing, panSwing, ...mod.nodes],
    dispose: mod.stop,
  })
}

/** Delay swing for a vibrato of up to a semitone (at 100% depth) at `rate` Hz. */
export function vibratoSwing(depth: number, rate: number): number {
  // A delay swinging by A seconds at f Hz bends the pitch by about 2πfA.
  return Math.min(0.01, (fraction(depth) * 0.059) / (2 * Math.PI * Math.max(0.1, rate)))
}

function vibrato(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const delay = ctx.createDelay(0.05)
  delay.delayTime.value = 0.012
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  const mod = lfo(ctx)
  dw.input.connect(delay).connect(tone).connect(dw.wet)
  mod.out.connect(delay.delayTime)
  const bindings = {
    rate: [
      { param: mod.osc.frequency, map: identity },
      { param: mod.out.gain, map: (r: number, p) => vibratoSwing(p.depth as number, r) },
    ] as Binding[],
    depth: [{ param: mod.out.gain, map: (d: number, p) => vibratoSwing(d, p.rate as number) }] as Binding[],
    tone: [{ param: tone.frequency, map: nyquistSafe(ctx) }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, delay, tone, ...mod.nodes],
    dispose: mod.stop,
  })
}

function tape(ctx: BaseAudioContext, effect: Effect): EffectInstance {
  const dw = dryWet(ctx)
  const delay = ctx.createDelay(0.1)
  delay.delayTime.value = 0.015
  const wow = lfo(ctx)
  wow.osc.frequency.value = 0.6
  const flutter = lfo(ctx, 'triangle')
  flutter.osc.frequency.value = 7.5
  wow.out.connect(delay.delayTime)
  flutter.out.connect(delay.delayTime)
  const shaper = ctx.createWaveShaper()
  shaper.curve = saturationCurve(4) as Float32Array<ArrayBuffer>
  shaper.oversample = '2x'
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  dw.input.connect(delay).connect(shaper).connect(tone).connect(dw.wet)

  // Hiss: looped noise, high-passed, rising with wear.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const random = seededRandom(seedFromId(effect.id))
  noise.getChannelData(0).forEach((_, i, data) => (data[i] = random() * 2 - 1))
  const hiss = ctx.createBufferSource()
  hiss.buffer = noise
  hiss.loop = true
  const hissFilter = ctx.createBiquadFilter()
  hissFilter.type = 'highpass'
  hissFilter.frequency.value = 4000
  const hissLevel = ctx.createGain()
  hiss.connect(hissFilter).connect(hissLevel).connect(dw.wet)
  hiss.start()

  const hz = nyquistSafe(ctx)
  const bindings = {
    wobble: [{ param: wow.out.gain, map: (w: number) => fraction(w) * 0.0035 }],
    flutter: [{ param: flutter.out.gain, map: (f: number) => fraction(f) * 0.0003 }],
    wear: [
      { param: tone.frequency, map: (w: number) => hz(18000 * (4000 / 18000) ** fraction(w)) },
    ],
    noise: [{ param: hissLevel.gain, map: (n: number) => fraction(n) ** 2 * 0.003 }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, delay, shaper, tone, hiss, hissFilter, hissLevel, ...wow.nodes, ...flutter.nodes],
    dispose: () => {
      wow.stop()
      flutter.stop()
      try {
        hiss.stop()
      } catch {
        // Already stopped.
      }
    },
  })
}

function bitcrusher(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  let node: AudioWorkletNode | GainNode
  try {
    node = new AudioWorkletNode(ctx, 'monkey-daw-crusher', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  } catch {
    // Worklet not loaded: pass the signal through rather than breaking the chain.
    node = ctx.createGain()
  }
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  dw.input.connect(node).connect(tone).connect(dw.wet)
  const bindings: Record<string, Binding[]> = { mix: dw.mixBindings, tone: [{ param: tone.frequency, map: nyquistSafe(ctx) }] }
  if (node instanceof AudioWorkletNode) {
    for (const key of ['bits', 'downsample']) {
      const param = node.parameters.get(key)
      if (param) bindings[key] = [{ param, map: identity }]
    }
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, node, tone],
  })
}

function clipper(ctx: BaseAudioContext): EffectInstance {
  // The curve covers ±2, so the signal is halved going in: peaks up to +6 dB get rounded off.
  const pre = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  shaper.oversample = '4x'
  const post = ctx.createGain()
  pre.connect(shaper).connect(post)
  let softness: number | null = null
  const bindings = {
    drive: [{ param: pre.gain, map: (db: number) => dbToGain(db) / 2 }],
    ceiling: [{ param: post.gain, map: dbToGain }],
  }
  return instance(ctx, {
    input: pre,
    output: post,
    bindings: () => bindings,
    configure: (p) => {
      if (p.softness === softness) return
      softness = p.softness as number
      shaper.curve = softClipCurve(fraction(softness)) as Float32Array<ArrayBuffer>
    },
    nodes: () => [pre, shaper, post],
  })
}

function tilt(ctx: BaseAudioContext): EffectInstance {
  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  const output = ctx.createGain()
  low.connect(high).connect(output)
  const bindings = {
    output: [{ param: output.gain, map: dbToGain }],
    tilt: [
      { param: low.gain, map: (t: number) => -t },
      { param: high.gain, map: identity },
    ],
    pivot: [
      { param: low.frequency, map: identity },
      { param: high.frequency, map: identity },
    ],
  }
  return instance(ctx, { input: low, output, bindings: () => bindings, nodes: () => [low, high, output] })
}

function air(ctx: BaseAudioContext): EffectInstance {
  const shelf = ctx.createBiquadFilter()
  shelf.type = 'highshelf'
  const bindings = {
    amount: [{ param: shelf.gain, map: identity }],
    freq: [{ param: shelf.frequency, map: nyquistSafe(ctx) }],
  }
  return instance(ctx, { input: shelf, output: shelf, bindings: () => bindings, nodes: () => [shelf] })
}

function midside(ctx: BaseAudioContext): EffectInstance {
  const input = stereoInput(ctx)
  const { split, merge } = splitStereo(ctx)
  input.connect(split)
  // mid = (L + R) / 2, side = (L − R) / 2; back to L = mid + side, R = mid − side.
  const gain = (value: number) => {
    const g = ctx.createGain()
    g.gain.value = value
    return g
  }
  const mid = gain(1)
  const side = gain(1)
  const parts = [gain(0.5), gain(0.5), gain(0.5), gain(-0.5)]
  split.connect(parts[0], 0).connect(mid)
  split.connect(parts[1], 1).connect(mid)
  split.connect(parts[2], 0).connect(side)
  split.connect(parts[3], 1).connect(side)
  const invert = gain(-1)
  // Mono bass: the sides lose everything below the cutoff, so the lows stay in the centre.
  const sideLowCut = ctx.createBiquadFilter()
  sideLowCut.type = 'highpass'
  mid.connect(merge, 0, 0)
  mid.connect(merge, 0, 1)
  side.connect(sideLowCut)
  sideLowCut.connect(merge, 0, 0)
  sideLowCut.connect(invert).connect(merge, 0, 1)
  const bindings = {
    mid: [{ param: mid.gain, map: dbToGain }],
    side: [{ param: side.gain, map: dbToGain }],
    bassFreq: [{ param: sideLowCut.frequency, map: (hz: number, p) => (p.monoBass === true ? hz : 10) }] as Binding[],
  }
  return instance(ctx, {
    input,
    output: merge,
    bindings: () => bindings,
    nodes: () => [input, split, merge, mid, side, sideLowCut, invert, ...parts],
  })
}

function slapback(ctx: BaseAudioContext): EffectInstance {
  const dw = dryWet(ctx)
  const delay = ctx.createDelay(0.5)
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  const feedback = ctx.createGain()
  dw.input.connect(delay).connect(tone).connect(dw.wet)
  tone.connect(feedback).connect(delay)
  const bindings = {
    time: [{ param: delay.delayTime, map: toSeconds }],
    tone: [{ param: tone.frequency, map: nyquistSafe(ctx) }],
    feedback: [{ param: feedback.gain, map: fraction }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    nodes: () => [...dw.nodes, delay, tone, feedback],
  })
}

function plate(ctx: BaseAudioContext, effect: Effect): EffectInstance {
  const dw = dryWet(ctx)
  const preDelay = ctx.createDelay(0.25)
  const convolver = ctx.createConvolver()
  const lowCut = ctx.createBiquadFilter()
  lowCut.type = 'highpass'
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  dw.input.connect(preDelay).connect(convolver).connect(lowCut).connect(tone).connect(dw.wet)
  const seed = seedFromId(effect.id)
  let decay: number | null = null
  const hz = nyquistSafe(ctx)
  const bindings = {
    preDelay: [{ param: preDelay.delayTime, map: toSeconds }],
    tone: [{ param: tone.frequency, map: hz }],
    lowCut: [{ param: lowCut.frequency, map: hz }],
    mix: dw.mixBindings,
  }
  return instance(ctx, {
    input: dw.input,
    output: dw.output,
    bindings: () => bindings,
    configure: (p) => {
      if (p.decay === decay) return
      decay = p.decay as number
      const channels = plateImpulse(ctx.sampleRate, decay, seed)
      const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate)
      channels.forEach((data, i) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, i))
      convolver.buffer = buffer
    },
    nodes: () => [...dw.nodes, preDelay, convolver, lowCut, tone],
  })
}

function spread(ctx: BaseAudioContext): EffectInstance {
  const input = stereoInput(ctx)
  const { split, merge } = splitStereo(ctx)
  input.connect(split)
  // The left side stays; the right side blends toward a slightly late copy of the mono sum.
  const sum = ctx.createGain()
  const halfL = ctx.createGain()
  const halfR = ctx.createGain()
  halfL.gain.value = halfR.gain.value = 0.5
  split.connect(halfL, 0).connect(sum)
  split.connect(halfR, 1).connect(sum)
  const delay = ctx.createDelay(0.05)
  const late = ctx.createGain()
  const rightDry = ctx.createGain()
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  sum.connect(delay).connect(late).connect(tone).connect(merge, 0, 1)
  split.connect(rightDry, 1).connect(merge, 0, 1)
  split.connect(merge, 0, 0)
  const bindings = {
    amount: [
      { param: rightDry.gain, map: (a: number) => 1 - fraction(a) },
      { param: late.gain, map: fraction },
    ],
    time: [{ param: delay.delayTime, map: toSeconds }],
    tone: [{ param: tone.frequency, map: nyquistSafe(ctx) }],
  }
  return instance(ctx, {
    input,
    output: merge,
    bindings: () => bindings,
    nodes: () => [input, split, merge, sum, halfL, halfR, delay, late, tone, rightDry],
  })
}

function duck(ctx: BaseAudioContext): EffectInstance {
  const amp = ctx.createGain()
  return instance(ctx, {
    input: amp,
    output: amp,
    bindings: () => ({}),
    // Pulses land on the song's grid: every pulse time is a multiple of the interval from 0.
    schedule: (window, ctxOffset, params, bpm) => {
      const interval = duckInterval(params, bpm)
      const depth = fraction(params.depth as number)
      const { tau, hold } = duckShape(params, interval)
      const g = amp.gain
      const start = Math.max(ctx.currentTime, window.from + ctxOffset)
      if (window.catchUp) {
        g.cancelScheduledValues(start)
        const phase = ((window.from % interval) + interval) % interval
        g.setValueAtTime(duckGain(phase, depth, tau, hold), start)
      }
      for (const t of duckPulses(window.from, window.to, interval)) {
        const at = t + ctxOffset
        if (at < start) continue
        g.setTargetAtTime(1 - depth, at, DUCK_ATTACK / 3)
        g.setTargetAtTime(1, at + DUCK_ATTACK + hold, tau)
      }
    },
    nodes: () => [amp],
  })
}

type CharacterType = 'chorus' | 'phaser' | 'tremolo' | 'vibrato' | 'tape' | 'bitcrusher' | 'clipper' | 'tilt' | 'air' | 'midside' | 'slapback' | 'plate' | 'spread' | 'duck'

export const CHARACTER_BUILDERS: Record<CharacterType, Builder> = {
  chorus,
  phaser,
  tremolo,
  vibrato,
  tape,
  bitcrusher,
  clipper,
  tilt,
  air,
  midside,
  slapback,
  plate,
  spread,
  duck,
}
