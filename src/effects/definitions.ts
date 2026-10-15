// Effect definitions: every effect's parameters with their ranges, units and defaults. The
// audio code, the rack UI and project loading all read from this one table.

import { createId } from '../model/factory'
import { SCALE_KEYS } from './specialist-dsp'
import type { Effect, EffectParams, EffectType } from '../model/types'

export type ParamUnit = 'Hz' | 'dB' | 'ms' | 's' | '%' | ':1' | 'Q' | 'bits' | 'x' | 'ct'

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
  /**
   * A choice that locks a number to the tempo: while the choice isn't 'off', `param` follows the
   * note length instead of its knob ('time' in seconds or 'rate' in Hz).
   */
  sync?: { choice: string; param: string; as: 'time' | 'rate' }
  /** Which batch it belongs to; the effect picker lists them in these groups. */
  group: 'essentials' | 'character' | 'specialist'
}

const fixed = (p: NumberParam): NumberParam => ({ ...p, automatable: false })

const syncChoice = (fallback: string, divisions: string[] = Object.keys(SYNC_DIVISIONS)): ChoiceParam => ({
  kind: 'choice',
  key: 'sync',
  label: 'Sync',
  options: [{ value: 'off', label: 'Free' }, ...divisions.map((v) => ({ value: v, label: v }))],
  default: fallback,
})

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

/** Auto-tune scale names. */
const SCALE_LABELS: Record<string, string> = {
  chromatic: 'Chromatic',
  major: 'Major',
  minor: 'Minor',
  harmonicMinor: 'Harmonic minor',
  majorPentatonic: 'Major pentatonic',
  minorPentatonic: 'Minor pentatonic',
}

export const EFFECTS: Record<EffectType, EffectDef> = {
  eq: {
    type: 'eq',
    group: 'essentials',
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
    group: 'essentials',
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
    group: 'essentials',
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
    group: 'essentials',
    name: 'Delay',
    description: 'Echoes, free or locked to the tempo; ping-pong bounces them left and right.',
    sync: { choice: 'sync', param: 'time', as: 'time' },
    params: [
      syncChoice('1/8'),
      num('time', 'Time', 1, 2000, 375, 'ms', 'log'),
      num('feedback', 'Feedback', 0, 95, 35, '%'),
      num('tone', 'Tone', 500, 20000, 6000, 'Hz', 'log'),
      { kind: 'toggle', key: 'pingPong', label: 'Ping-pong', default: false },
      num('mix', 'Mix', 0, 100, 25, '%'),
    ],
  },
  reverb: {
    type: 'reverb',
    group: 'essentials',
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
    group: 'essentials',
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
    group: 'essentials',
    name: 'Gate',
    description: 'Silences the signal below the threshold: removes noise and spill between notes.',
    params: [
      num('threshold', 'Threshold', -80, 0, -50, 'dB'),
      num('attack', 'Attack', 0.1, 50, 1, 'ms', 'log'),
      num('release', 'Release', 5, 1000, 100, 'ms', 'log'),
      num('range', 'Range', -80, 0, -80, 'dB'),
    ],
  },

  // --- Batch 2: character and space -----------------------------------------------------------
  chorus: {
    type: 'chorus',
    group: 'character',
    name: 'Chorus',
    description: 'Thickens and widens with gently detuned, moving copies.',
    params: [
      num('rate', 'Rate', 0.05, 5, 0.8, 'Hz', 'log'),
      num('depth', 'Depth', 0, 100, 40, '%'),
      num('delay', 'Delay', 5, 30, 12, 'ms'),
      num('width', 'Width', 0, 100, 70, '%'),
      num('mix', 'Mix', 0, 100, 50, '%'),
    ],
  },
  phaser: {
    type: 'phaser',
    group: 'character',
    name: 'Phaser / Flanger',
    description: 'Sweeping, swirling movement: soft notches (phaser) or a jet-like comb (flanger).',
    params: [
      {
        kind: 'choice',
        key: 'mode',
        label: 'Type',
        options: [
          { value: 'phaser', label: 'Phaser' },
          { value: 'flanger', label: 'Flanger' },
        ],
        default: 'phaser',
      },
      num('rate', 'Rate', 0.05, 10, 0.5, 'Hz', 'log'),
      num('depth', 'Depth', 0, 100, 70, '%'),
      num('feedback', 'Feedback', 0, 90, 40, '%'),
      num('mix', 'Mix', 0, 100, 50, '%'),
    ],
  },
  tremolo: {
    type: 'tremolo',
    group: 'character',
    name: 'Tremolo / Auto-pan',
    description: 'Pulses the volume (tremolo) or moves the sound left and right (auto-pan), free or in time.',
    sync: { choice: 'sync', param: 'rate', as: 'rate' },
    params: [
      {
        kind: 'choice',
        key: 'mode',
        label: 'Type',
        options: [
          { value: 'tremolo', label: 'Tremolo' },
          { value: 'autopan', label: 'Auto-pan' },
        ],
        default: 'tremolo',
      },
      syncChoice('1/8'),
      num('rate', 'Rate', 0.1, 20, 4, 'Hz', 'log'),
      num('depth', 'Depth', 0, 100, 50, '%'),
      {
        kind: 'choice',
        key: 'shape',
        label: 'Shape',
        options: [
          { value: 'sine', label: 'Smooth' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'square', label: 'Choppy' },
        ],
        default: 'sine',
      },
    ],
  },
  vibrato: {
    type: 'vibrato',
    group: 'character',
    name: 'Vibrato',
    description: 'Wobbles the pitch, like a singer’s or a guitarist’s vibrato.',
    params: [num('rate', 'Rate', 0.5, 12, 5, 'Hz', 'log'), num('depth', 'Depth', 0, 100, 30, '%')],
  },
  tape: {
    type: 'tape',
    group: 'character',
    name: 'Tape',
    description: 'Old tape: slow wobble, fast flutter, and wear that dulls the highs and adds hiss.',
    params: [
      num('wobble', 'Wobble', 0, 100, 25, '%'),
      num('flutter', 'Flutter', 0, 100, 15, '%'),
      num('wear', 'Wear', 0, 100, 30, '%'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
  bitcrusher: {
    type: 'bitcrusher',
    group: 'character',
    name: 'Bitcrusher',
    description: 'Lo-fi digital grit: fewer bits and a lower sample rate.',
    params: [
      num('bits', 'Bits', 1, 16, 8, 'bits'),
      num('downsample', 'Downsample', 1, 32, 4, 'x', 'log'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
  clipper: {
    type: 'clipper',
    group: 'character',
    name: 'Soft clipper',
    description: 'Rounds off peaks so the sound gets louder without harsh overs.',
    params: [
      num('drive', 'Drive', 0, 24, 0, 'dB'),
      num('ceiling', 'Ceiling', -12, 0, -0.3, 'dB'),
      fixed(num('softness', 'Softness', 0, 100, 50, '%')),
    ],
  },
  tilt: {
    type: 'tilt',
    group: 'character',
    name: 'Tilt EQ',
    description: 'One knob for tone: tilts toward brighter (right) or darker (left) around a pivot.',
    params: [num('tilt', 'Tilt', -6, 6, 0, 'dB'), num('pivot', 'Pivot', 200, 5000, 800, 'Hz', 'log')],
  },
  air: {
    type: 'air',
    group: 'character',
    name: 'Air',
    description: 'A gentle lift of the very top end for openness and sparkle.',
    params: [num('amount', 'Amount', 0, 12, 3, 'dB'), num('freq', 'Freq', 8000, 20000, 12000, 'Hz', 'log')],
  },
  midside: {
    type: 'midside',
    group: 'character',
    name: 'Mid/Side',
    description: 'Balances the centre (mid) against the sides: turn the sides up to widen, down to narrow.',
    params: [num('mid', 'Mid', -12, 6, 0, 'dB'), num('side', 'Side', -24, 12, 0, 'dB')],
  },
  slapback: {
    type: 'slapback',
    group: 'character',
    name: 'Slapback',
    description: 'One quick echo, the classic rockabilly and vocal slap.',
    params: [
      num('time', 'Time', 40, 250, 110, 'ms'),
      num('tone', 'Tone', 1000, 12000, 4000, 'Hz', 'log'),
      num('feedback', 'Feedback', 0, 40, 0, '%'),
      num('mix', 'Mix', 0, 100, 25, '%'),
    ],
  },
  plate: {
    type: 'plate',
    group: 'character',
    name: 'Plate reverb',
    description: 'A dense, bright plate: smooth on vocals and snares.',
    params: [
      fixed(num('decay', 'Decay', 0.3, 6, 1.8, 's', 'log')),
      num('preDelay', 'Pre-delay', 0, 150, 0, 'ms'),
      num('tone', 'Tone', 2000, 20000, 9000, 'Hz', 'log'),
      num('lowCut', 'Low cut', 20, 1000, 150, 'Hz', 'log'),
      num('mix', 'Mix', 0, 100, 25, '%'),
    ],
  },
  spread: {
    type: 'spread',
    group: 'character',
    name: 'Stereo spread',
    description: 'Makes a mono sound wide by delaying one side a few milliseconds.',
    params: [num('amount', 'Amount', 0, 100, 50, '%'), num('time', 'Time', 2, 30, 12, 'ms')],
  },
  duck: {
    type: 'duck',
    group: 'character',
    name: 'Sidechain duck',
    description: 'Pumps the volume in time with the beat, like a kick-triggered sidechain.',
    params: [
      {
        kind: 'choice',
        key: 'rate',
        label: 'Every',
        options: ['1/2', '1/4', '1/8', '1/16'].map((v) => ({ value: v, label: v })),
        default: '1/4',
      },
      fixed(num('depth', 'Depth', 0, 100, 60, '%')),
      fixed(num('release', 'Release', 10, 100, 60, '%')),
    ],
  },

  // --- Batch 3: specialist ---------------------------------------------------------------------
  transient: {
    type: 'transient',
    group: 'specialist',
    name: 'Transient shaper',
    description: 'Makes hits punchier or softer, and their ring longer or shorter, at any level.',
    params: [
      num('attack', 'Attack', -100, 100, 0, '%'),
      num('sustain', 'Sustain', -100, 100, 0, '%'),
      num('output', 'Output', -12, 12, 0, 'dB'),
    ],
  },
  deesser: {
    type: 'deesser',
    group: 'specialist',
    name: 'De-esser',
    description: 'Tames harsh “s” and “sh” sounds in vocals by turning down only the highs when they spike.',
    params: [
      num('freq', 'Freq', 2000, 16000, 6000, 'Hz', 'log'),
      num('threshold', 'Threshold', -60, 0, -30, 'dB'),
      num('range', 'Range', 0, 24, 10, 'dB'),
    ],
  },
  opto: {
    type: 'opto',
    group: 'specialist',
    name: 'Opto compressor',
    description: 'Smooth, musical compression with one main knob, in the style of classic optical units.',
    params: [
      num('peakReduction', 'Peak reduction', 0, 100, 40, '%'),
      num('gain', 'Gain', 0, 30, 6, 'dB'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
  doubler: {
    type: 'doubler',
    group: 'specialist',
    name: '12-string doubler',
    description: 'Turns a 6-string into a shimmering 12-string: an octave-up copy and a detuned double, spread wide.',
    params: [
      num('octave', 'Octave', 0, 100, 60, '%'),
      num('detune', 'Detune', 0, 30, 8, 'ct'),
      num('spread', 'Spread', 0, 100, 70, '%'),
      num('mix', 'Mix', 0, 100, 50, '%'),
    ],
  },
  amp: {
    type: 'amp',
    group: 'specialist',
    name: 'Amp / cabinet',
    description: 'A guitar amp’s drive and tone stack, through a speaker cabinet.',
    params: [
      num('drive', 'Drive', 0, 40, 18, 'dB'),
      num('bass', 'Bass', -12, 12, 0, 'dB'),
      num('mid', 'Mid', -12, 12, 0, 'dB'),
      num('treble', 'Treble', -12, 12, 0, 'dB'),
      {
        kind: 'choice',
        key: 'cabinet',
        label: 'Cabinet',
        options: [
          { value: 'off', label: 'None' },
          { value: '1x12', label: '1×12' },
          { value: '4x12', label: '4×12' },
        ],
        default: '1x12',
      },
      num('output', 'Output', -30, 6, -12, 'dB'),
    ],
  },
  autotune: {
    type: 'autotune',
    group: 'specialist',
    name: 'Auto-tune',
    description: 'Pulls the pitch to the nearest note of a key and scale: natural at slow retune, the hard robotic effect at 0 ms.',
    params: [
      {
        kind: 'choice',
        key: 'key',
        label: 'Key',
        options: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((label, i) => ({ value: String(i), label })),
        default: '0',
      },
      {
        kind: 'choice',
        key: 'scale',
        label: 'Scale',
        options: SCALE_KEYS.map((value) => ({ value, label: SCALE_LABELS[value] ?? value })),
        default: 'chromatic',
      },
      num('retune', 'Retune', 0, 400, 40, 'ms'),
      num('amount', 'Amount', 0, 100, 100, '%'),
      num('mix', 'Mix', 0, 100, 100, '%'),
    ],
  },
}

/** Seconds between duck pulses. */
export function duckInterval(params: EffectParams, bpm: number): number {
  return ((SYNC_DIVISIONS[params.rate as string] ?? 1) * 60) / bpm
}

/** A tempo-synced number's value (seconds or Hz), or null when the effect runs free. */
export function syncedValue(type: EffectType, params: EffectParams, bpm: number): number | null {
  const sync = EFFECTS[type].sync
  const division = sync && SYNC_DIVISIONS[params[sync.choice] as string]
  if (!sync || !division) return null
  const seconds = (division * 60) / bpm
  return sync.as === 'time' ? seconds : 1 / seconds
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

/** LFO rate in Hz: one cycle per synced note length, or the free rate. */
export function lfoRate(params: EffectParams, bpm: number): number {
  const division = SYNC_DIVISIONS[params.sync as string]
  return division ? bpm / 60 / division : (params.rate as number)
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
    case 'bits':
      return `${Math.floor(value)} bit`
    case 'x':
      return `${value < 10 ? value.toFixed(1) : Math.round(value)}×`
    case 'ct':
      return `${Math.round(value)} ct`
  }
}
