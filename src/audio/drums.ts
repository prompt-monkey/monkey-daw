// Drum pad playback: synthesized drum sounds made of a few layers (a pitched oscillator or
// noise, an optional filter and a decaying envelope), or the pad's own sample.

import type { DrumPad, DrumVoice } from '../model/types'
import type { InstrumentVoice } from './instruments'

interface Layer {
  source: 'noise' | OscillatorType
  /** Oscillator frequency in Hz; with `sweep`, it starts at freq × sweep and falls to freq. */
  freq?: number
  sweep?: number
  /** Seconds the pitch sweep takes. */
  sweepTime?: number
  filter?: { type: BiquadFilterType; freq: number; q?: number }
  gain: number
  /** Seconds to fall 60 dB (scaled by the pad's decay). */
  decay: number
  attack?: number
  /** Hand-clap style: a few quick retriggers before the main decay. */
  bursts?: number
}

const VOICES: Record<DrumVoice, Layer[]> = {
  kick: [
    { source: 'sine', freq: 48, sweep: 3.3, sweepTime: 0.12, gain: 1, decay: 0.5 },
    { source: 'noise', filter: { type: 'highpass', freq: 3000 }, gain: 0.25, decay: 0.012 },
  ],
  sub: [{ source: 'sine', freq: 45, sweep: 1.6, sweepTime: 0.06, gain: 1, decay: 1.1 }],
  snare: [
    { source: 'noise', filter: { type: 'bandpass', freq: 1800, q: 0.7 }, gain: 0.9, decay: 0.22 },
    { source: 'triangle', freq: 165, sweep: 1.2, sweepTime: 0.03, gain: 0.6, decay: 0.12 },
  ],
  clap: [{ source: 'noise', filter: { type: 'bandpass', freq: 1300, q: 1.1 }, gain: 1, decay: 0.2, bursts: 3 }],
  rim: [
    { source: 'square', freq: 1750, filter: { type: 'bandpass', freq: 1750, q: 4 }, gain: 0.5, decay: 0.04 },
    { source: 'triangle', freq: 450, gain: 0.5, decay: 0.04 },
  ],
  'hat-closed': [{ source: 'noise', filter: { type: 'highpass', freq: 7000 }, gain: 0.5, decay: 0.06 }],
  'hat-open': [{ source: 'noise', filter: { type: 'highpass', freq: 7000 }, gain: 0.45, decay: 0.4 }],
  crash: [{ source: 'noise', filter: { type: 'highpass', freq: 4500 }, gain: 0.45, decay: 1.6 }],
  ride: [
    { source: 'noise', filter: { type: 'bandpass', freq: 7500, q: 0.8 }, gain: 0.35, decay: 1.1 },
    { source: 'square', freq: 3200, filter: { type: 'bandpass', freq: 3200, q: 6 }, gain: 0.08, decay: 0.8 },
  ],
  'tom-low': [{ source: 'sine', freq: 95, sweep: 1.5, sweepTime: 0.1, gain: 0.9, decay: 0.45 }],
  'tom-mid': [{ source: 'sine', freq: 135, sweep: 1.5, sweepTime: 0.1, gain: 0.9, decay: 0.4 }],
  'tom-high': [{ source: 'sine', freq: 185, sweep: 1.5, sweepTime: 0.1, gain: 0.9, decay: 0.35 }],
  cowbell: [
    { source: 'square', freq: 540, filter: { type: 'bandpass', freq: 800, q: 2.5 }, gain: 0.35, decay: 0.3 },
    { source: 'square', freq: 800, filter: { type: 'bandpass', freq: 800, q: 2.5 }, gain: 0.35, decay: 0.3 },
  ],
  shaker: [{ source: 'noise', filter: { type: 'highpass', freq: 5500 }, gain: 0.45, decay: 0.09, attack: 0.012 }],
  'conga-low': [{ source: 'sine', freq: 210, sweep: 1.2, sweepTime: 0.03, gain: 0.8, decay: 0.25 }],
  'conga-high': [{ source: 'sine', freq: 320, sweep: 1.2, sweepTime: 0.03, gain: 0.8, decay: 0.2 }],
}

/** Seconds a synthesized pad sounds for (its longest layer). */
export function drumLength(pad: Pick<DrumPad, 'voice' | 'decay'>): number {
  return Math.max(...VOICES[pad.voice].map((l) => (l.attack ?? 0) + l.decay * pad.decay))
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // A fixed pseudo-random sequence, so offline renders are repeatable.
    let seed = 12345
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      data[i] = (seed / 0x3fffffff) - 1
    }
    noiseBuffers.set(ctx, buffer)
  }
  return buffer
}

const SILENT = 0.0001

/** Plays one hit of a pad at `when` (AudioContext time) into `destination`. */
export function playDrumPad(
  ctx: BaseAudioContext,
  destination: AudioNode,
  pad: DrumPad,
  velocity: number,
  when: number,
  sample?: AudioBuffer,
): InstrumentVoice {
  const peak = 0.9 * velocity ** 1.3 * pad.gain
  const pitch = 2 ** (pad.tune / 12)
  const sources: AudioScheduledSourceNode[] = []
  const nodes: AudioNode[] = []

  if (pad.sample && sample) {
    const src = ctx.createBufferSource()
    const amp = ctx.createGain()
    src.buffer = sample
    src.playbackRate.value = pitch
    amp.gain.value = peak
    src.connect(amp).connect(destination)
    src.start(when)
    sources.push(src)
    nodes.push(amp)
  } else {
    for (const layer of VOICES[pad.voice]) {
      const decay = layer.decay * pad.decay
      const attack = layer.attack ?? 0
      const end = when + attack + decay
      let src: AudioScheduledSourceNode
      if (layer.source === 'noise') {
        const n = ctx.createBufferSource()
        n.buffer = noise(ctx)
        n.loop = true
        src = n
      } else {
        const osc = ctx.createOscillator()
        osc.type = layer.source
        const f = (layer.freq ?? 440) * pitch
        osc.frequency.setValueAtTime(f * (layer.sweep ?? 1), when)
        if (layer.sweep) osc.frequency.exponentialRampToValueAtTime(f, when + (layer.sweepTime ?? 0.05))
        src = osc
      }
      let tail: AudioNode = src
      if (layer.filter) {
        const filter = ctx.createBiquadFilter()
        filter.type = layer.filter.type
        filter.frequency.value = Math.min(ctx.sampleRate / 2 - 100, layer.filter.freq * pitch)
        filter.Q.value = layer.filter.q ?? 0.7
        tail.connect(filter)
        tail = filter
        nodes.push(filter)
      }
      const amp = ctx.createGain()
      const level = peak * layer.gain
      const g = amp.gain
      g.setValueAtTime(attack ? SILENT : level, when)
      if (attack) g.linearRampToValueAtTime(level, when + attack)
      let t = when + attack
      for (let b = 1; b < (layer.bursts ?? 1); b++) {
        // Each burst drops quickly, then the next one hits.
        g.exponentialRampToValueAtTime(level * 0.15, t + 0.01)
        t += 0.011
        g.setValueAtTime(level, t)
      }
      g.exponentialRampToValueAtTime(SILENT, Math.max(t + 0.005, end))
      tail.connect(amp).connect(destination)
      src.start(when)
      src.stop(end + 0.02)
      sources.push(src)
      nodes.push(amp)
    }
  }

  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    for (const s of sources) s.disconnect()
    for (const n of nodes) n.disconnect()
  }
  const voice: InstrumentVoice = {
    stop: () => {
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          // Already stopped.
        }
      }
      cleanup()
    },
  }
  // Layers end together within a few milliseconds; wait for the longest one.
  let pending = sources.length
  for (const s of sources) {
    s.onended = () => {
      if (--pending > 0) return
      cleanup()
      voice.onEnded?.()
    }
  }
  return voice
}
