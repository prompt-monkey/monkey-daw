// Effect definitions: every effect's parameters with their ranges, units and defaults. The
// audio code, the rack UI and project loading all read from this one table.

import { createId } from '../model/factory'
import type { Effect, EffectParams, EffectType } from '../model/types'

export type ParamUnit = 'Hz' | 'dB' | 'ms' | 's' | '%' | ':1' | 'Q'

export interface NumberParam {
  kind: 'number'
  key: string
  label: string
  min: number
  max: number
  default: number
  unit: ParamUnit
  /** Log scale for frequencies, times and ratios: equal knob travel per octave or doubling. */
  scale: 'linear' | 'log'
  /** False for parameters that rebuild audio data when changed, so they can't move smoothly. */
  automatable?: boolean
}

export interface ChoiceParam {
  kind: 'choice'
  key: string
  label: string
  options: { value: string; label: string }[]
  default: string
}

export interface ToggleParam {
  kind: 'toggle'
  key: string
  label: string
  default: boolean
}

export type ParamDef = NumberParam | ChoiceParam | ToggleParam

export interface EffectDef {
  type: EffectType
  name: string
  description: string
  params: ParamDef[]
}

const num = (key: string, label: string, min: number, max: number, def: number, unit: ParamUnit, scale: 'linear' | 'log' = 'linear'): NumberParam => ({
  kind: 'number',
  key,
  label,
  min,
  max,
  default: def,
  unit,
  scale,
})

/** Note lengths for tempo-synced delay times, in quarter notes. */
export const SYNC_DIVISIONS: Record<string, number> = {
  '1/2': 2,
  '1/4d': 1.5,
  '1/4': 1,
  '1/8d': 0.75,
  '1/4t': 2 / 3,
  '1/8': 0.5,
  '1/8t': 1 / 3,
  '1/16': 0.25,
}

export const EFFECTS: Record<EffectType, EffectDef> = {
  eq: {
    type: 'eq',
    name: 'EQ',
    description: 'Shape the tone: low and high shelves, a sweepable mid, and low/high cut filters.',
    params: [
      num('lowCut', 'Low cut', 20, 1000, 20, 'Hz', 'log'),
      num('lowGain', 'Low', -18, 18, 0, 'dB'),
      num('lowFreq', 'Low freq', 40, 500, 120, 'Hz', 'log'),
      num('midGain', 'Mid', -18, 18, 0, 'dB'),
      num('midFreq', 'Mid freq', 200, 8000, 1000, 'Hz', 'log'),
      num('midQ', 'Mid Q', 0.3, 8, 1, 'Q', 'log'),
      num('highGain', 'High', -18, 18, 0, 'dB'),
      num('highFreq', 'High freq', 2000, 16000, 8000, 'Hz', 'log'),
      num('highCut', 'High cut', 2000, 20000, 20000, 'Hz', 'log'),
    ],
  },
  compressor: {
    type: 'compressor',
    name: 'Compressor',
    description: 'Evens out the level: loud parts are turned down above the threshold.',
    params: [
      num('threshold', 'Threshold', -60, 0, -18, 'dB'),
      num('ratio', 'Ratio', 1, 20, 4, ':1', 'log'),
      num('knee', 'Knee', 0, 30, 6, 'dB'),
      num('attack', 'Attack', 0.1, 200, 10, 'ms', 'log'),
      num('release', 'Release', 10, 1000, 150, 'ms', 'log'),
      num('makeup', 'Makeup', 0, 24, 0, 'dB'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
  filter: {
    type: 'filter',
    name: 'Filter',
    description: 'Removes highs (low-pass), lows (high-pass), or keeps a band.',
    params: [
      {
        kind: 'choice',
        key: 'mode',
        label: 'Type',
        options: [
          { value: 'lowpass', label: 'Low-pass' },
          { value: 'highpass', label: 'High-pass' },
          { value: 'bandpass', label: 'Band-pass' },
        ],
        default: 'lowpass',
      },
      num('cutoff', 'Cutoff', 20, 20000, 2000, 'Hz', 'log'),
      num('resonance', 'Resonance', 0.1, 20, 0.7, 'Q', 'log'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
  delay: {
    type: 'delay',
    name: 'Delay',
    description: 'Echoes, free or locked to the tempo; ping-pong bounces them left and right.',
    params: [
      {
        kind: 'choice',
        key: 'sync',
        label: 'Sync',
        options: [{ value: 'off', label: 'Free' }, ...Object.keys(SYNC_DIVISIONS).map((v) => ({ value: v, label: v }))],
        default: '1/8',
      },
      num('time', 'Time', 1, 2000, 375, 'ms', 'log'),
      num('feedback', 'Feedback', 0, 95, 35, '%'),
      num('tone', 'Tone', 500, 20000, 6000, 'Hz', 'log'),
      { kind: 'toggle', key: 'pingPong', label: 'Ping-pong', default: false },
      num('mix', 'Mix', 0, 100, 25, '%'),
    ],
  },
  reverb: {
    type: 'reverb',
    name: 'Reverb',
    description: 'Room and hall ambience.',
    params: [
      { ...num('decay', 'Decay', 0.2, 10, 2, 's', 'log'), automatable: false },
      num('preDelay', 'Pre-delay', 0, 200, 10, 'ms'),
      num('damping', 'Damping', 1000, 20000, 8000, 'Hz', 'log'),
      num('mix', 'Mix', 0, 100, 25, '%'),
    ],
  },
  saturation: {
    type: 'saturation',
    name: 'Saturation',
    description: 'Warm drive, from subtle thickening to heavy distortion.',
    params: [
      { ...num('drive', 'Drive', 0, 36, 12, 'dB'), automatable: false },
      num('tone', 'Tone', 1000, 20000, 12000, 'Hz', 'log'),
      num('output', 'Output', -24, 6, -6, 'dB'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
  gate: {
    type: 'gate',
    name: 'Gate',
    description: 'Silences the signal below the threshold: removes noise and spill between notes.',
    params: [
      num('threshold', 'Threshold', -80, 0, -50, 'dB'),
      num('attack', 'Attack', 0.1, 50, 1, 'ms', 'log'),
      num('release', 'Release', 5, 1000, 100, 'ms', 'log'),
      num('range', 'Range', -80, 0, -80, 'dB'),
    ],
  },
}

export const EFFECT_TYPES = Object.keys(EFFECTS) as EffectType[]

export function defaultParams(type: EffectType): EffectParams {
  return Object.fromEntries(EFFECTS[type].params.map((p) => [p.key, p.default]))
}

export function createEffect(type: EffectType, params: EffectParams = {}): Effect {
  return { id: createId('fx'), type, enabled: true, params: { ...defaultParams(type), ...normalizeParams(type, params) } }
}

/** A valid value for a parameter: clamped numbers, known choices, real booleans. */
export function normalizeParam(def: ParamDef, value: unknown): number | string | boolean {
  if (def.kind === 'number') {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : def.default
    return Math.min(def.max, Math.max(def.min, n))
  }
  if (def.kind === 'choice') return def.options.some((o) => o.value === value) ? (value as string) : def.default
  return typeof value === 'boolean' ? value : def.default
}

/** Keeps only known parameters, each made valid; missing ones are left out. */
export function normalizeParams(type: EffectType, params: Record<string, unknown>): EffectParams {
  const out: EffectParams = {}
  for (const def of EFFECTS[type].params) if (def.key in params) out[def.key] = normalizeParam(def, params[def.key])
  return out
}

/** Repairs stored effect data; returns null for unknown effect types. */
export function normalizeEffect(raw: unknown): Effect | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Effect> & Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.type !== 'string' || !(r.type in EFFECTS)) return null
  const type = r.type as EffectType
  return {
    id: r.id,
    type,
    enabled: r.enabled !== false,
    params: { ...defaultParams(type), ...normalizeParams(type, (r.params ?? {}) as Record<string, unknown>) },
  }
}

/** Numeric parameters of an effect that automation can move. */
export function automatableParams(type: EffectType): NumberParam[] {
  return EFFECTS[type].params.filter((p): p is NumberParam => p.kind === 'number' && p.automatable !== false)
}

export function findParam(type: EffectType, key: string): ParamDef | undefined {
  return EFFECTS[type].params.find((p) => p.key === key)
}

/** Knob position (0–1) for a value, following the parameter's scale. */
export function toNormalized(def: NumberParam, value: number): number {
  if (def.scale === 'log') return Math.log(value / def.min) / Math.log(def.max / def.min)
  return (value - def.min) / (def.max - def.min)
}

/** Value for a knob position (0–1). */
export function fromNormalized(def: NumberParam, position: number): number {
  const p = Math.min(1, Math.max(0, position))
  if (def.scale === 'log') return def.min * (def.max / def.min) ** p
  return def.min + p * (def.max - def.min)
}

/** Delay time in seconds: the synced note length at this tempo, or the free time. */
export function delaySeconds(params: EffectParams, bpm: number): number {
  const division = SYNC_DIVISIONS[params.sync as string]
  return division ? (division * 60) / bpm : (params.time as number) / 1000
}

/** Human-readable value, e.g. "1.2 kHz", "-6.0 dB", "4.0:1", "250 ms". */
export function formatValue(def: NumberParam, value: number): string {
  switch (def.unit) {
    case 'Hz':
      return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`
    case 'dB':
      return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
    case 'ms':
      return value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`
    case 's':
      return `${value.toFixed(value < 10 ? 2 : 1)} s`
    case '%':
      return `${Math.round(value)}%`
    case ':1':
      return `${value.toFixed(1)}:1`
    case 'Q':
      return value.toFixed(2)
  }
}
