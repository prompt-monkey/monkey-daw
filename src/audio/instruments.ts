// Instruments for MIDI tracks: a few built-in synth presets, and a sampler that pitches one
// sample across the keyboard. Each note is its own short-lived voice of standard audio nodes.

import { pitchToFrequency } from '../model/midi'
import type { Instrument, SynthPreset } from '../model/types'

interface Envelope {
  attack: number
  decay: number
  sustain: number
  release: number
}

interface SynthSpec {
  label: string
  oscillators: { type: OscillatorType; detune: number; gain: number; octave?: number }[]
  filter: { frequency: number; q: number; /** Cutoff at the note start, falling to `frequency`. */ peak?: number }
  envelope: Envelope
}

export const SYNTHS: Record<SynthPreset, SynthSpec> = {
  keys: {
    label: 'Keys',
    oscillators: [
      { type: 'triangle', detune: 0, gain: 0.7 },
      { type: 'sine', detune: 0, gain: 0.25, octave: 1 },
    ],
    filter: { frequency: 5000, q: 0.7 },
    envelope: { attack: 0.005, decay: 0.45, sustain: 0.35, release: 0.35 },
  },
  pluck: {
    label: 'Pluck',
    oscillators: [{ type: 'sawtooth', detune: 0, gain: 0.55 }],
    filter: { frequency: 700, q: 1.5, peak: 6000 },
    envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
  },
  bass: {
    label: 'Bass',
    oscillators: [
      { type: 'square', detune: 0, gain: 0.3 },
      { type: 'sine', detune: 0, gain: 0.6, octave: -1 },
    ],
    filter: { frequency: 900, q: 2 },
    envelope: { attack: 0.004, decay: 0.25, sustain: 0.7, release: 0.08 },
  },
  pad: {
    label: 'Pad',
    oscillators: [
      { type: 'sawtooth', detune: -8, gain: 0.3 },
      { type: 'sawtooth', detune: 8, gain: 0.3 },
    ],
    filter: { frequency: 1800, q: 0.7 },
    envelope: { attack: 0.45, decay: 0.8, sustain: 0.7, release: 1.2 },
  },
  lead: {
    label: 'Lead',
    oscillators: [
      { type: 'square', detune: -5, gain: 0.3 },
      { type: 'sawtooth', detune: 5, gain: 0.3 },
    ],
    filter: { frequency: 3500, q: 3 },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.75, release: 0.15 },
  },
}

const SAMPLER_ENVELOPE: Envelope = { attack: 0.002, decay: 0, sustain: 1, release: 0.08 }

export const INSTRUMENT_LABELS: Record<Instrument['type'], string> = {
  ...(Object.fromEntries(Object.entries(SYNTHS).map(([k, v]) => [k, v.label])) as Record<SynthPreset, string>),
  sampler: 'Sampler',
}

/** Seconds a note keeps sounding after it is released. */
export function releaseTime(instrument: Instrument): number {
  return instrument.type === 'sampler' ? SAMPLER_ENVELOPE.release : SYNTHS[instrument.type].envelope.release
}

/** Level of an ADSR envelope (peak 1) `t` seconds after the note starts, while held. */
export function envelopeLevel(env: Envelope, t: number): number {
  if (t <= 0) return 0
  if (t < env.attack) return t / env.attack
  if (env.decay <= 0) return env.sustain
  return env.sustain + (1 - env.sustain) * Math.exp(-(t - env.attack) / (env.decay / 3))
}

export interface NoteToPlay {
  pitch: number
  velocity: number
  /** Seconds the note is held before its release. */
  duration: number
  glideFrom: number | null
}

export interface InstrumentVoice {
  stop: () => void
  /** Called once the voice has finished, release included. */
  onEnded?: () => void
}

/** Applies an ADSR envelope (scaled by `peak`) to `param`, with the release at `when + held`. */
function scheduleEnvelope(param: AudioParam, env: Envelope, peak: number, when: number, held: number): number {
  param.setValueAtTime(0, when)
  const release = when + held
  if (held < env.attack) {
    param.linearRampToValueAtTime(peak * envelopeLevel(env, held), release)
  } else {
    param.linearRampToValueAtTime(peak, when + env.attack)
    if (env.decay > 0) param.setTargetAtTime(peak * env.sustain, when + env.attack, env.decay / 3)
    param.setValueAtTime(peak * envelopeLevel(env, held), release)
  }
  param.linearRampToValueAtTime(0, release + env.release)
  return release + env.release
}

/**
 * Starts one note at `when` (AudioContext time) into `destination`. The sampler needs `sample`;
 * without it, it falls back to the Keys synth.
 */
export function playInstrumentNote(
  ctx: BaseAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  note: NoteToPlay,
  when: number,
  sample?: AudioBuffer,
): InstrumentVoice {
  const peak = 0.45 * note.velocity ** 1.5
  const glide = note.glideFrom !== null ? Math.min(instrument.glide, note.duration) : 0
  const amp = ctx.createGain()
  amp.connect(destination)
  const sources: AudioScheduledSourceNode[] = []
  const nodes: AudioNode[] = [amp]

  if (instrument.type === 'sampler' && sample && instrument.sample) {
    const rate = (pitch: number) => 2 ** ((pitch - instrument.sample!.root) / 12)
    const src = ctx.createBufferSource()
    src.buffer = sample
    src.playbackRate.setValueAtTime(rate(glide ? note.glideFrom! : note.pitch), when)
    if (glide) src.playbackRate.exponentialRampToValueAtTime(rate(note.pitch), when + glide)
    src.connect(amp)
    const end = scheduleEnvelope(amp.gain, SAMPLER_ENVELOPE, peak * 1.6, when, note.duration)
    src.start(when)
    src.stop(end)
    sources.push(src)
  } else {
    const spec = SYNTHS[instrument.type === 'sampler' ? 'keys' : instrument.type]
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = spec.filter.q
    if (spec.filter.peak) {
      filter.frequency.setValueAtTime(spec.filter.peak, when)
      filter.frequency.setTargetAtTime(spec.filter.frequency, when, 0.08)
    } else {
      filter.frequency.value = spec.filter.frequency
    }
    filter.connect(amp)
    nodes.push(filter)
    const end = scheduleEnvelope(amp.gain, spec.envelope, peak, when, note.duration)
    for (const o of spec.oscillators) {
      const osc = ctx.createOscillator()
      const level = ctx.createGain()
      osc.type = o.type
      osc.detune.value = o.detune
      const freq = (pitch: number) => pitchToFrequency(pitch + 12 * (o.octave ?? 0))
      osc.frequency.setValueAtTime(freq(glide ? note.glideFrom! : note.pitch), when)
      if (glide) osc.frequency.exponentialRampToValueAtTime(freq(note.pitch), when + glide)
      level.gain.value = o.gain
      osc.connect(level).connect(filter)
      osc.start(when)
      osc.stop(end)
      sources.push(osc)
      nodes.push(level)
    }
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
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    for (const s of sources) s.disconnect()
    for (const n of nodes) n.disconnect()
  }
  // All sources stop together; the first to end signals the end of the voice.
  sources[0].onended = () => {
    cleanup()
    voice.onEnded?.()
  }
  return voice
}
