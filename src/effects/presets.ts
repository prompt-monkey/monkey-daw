// Effect chain presets: built-in starting points, plus chains you save (kept in this browser).

import { create } from 'zustand'
import type { Effect } from '../model/types'
import type { ChainTemplate } from '../state/actions'

export interface ChainPreset {
  name: string
  chain: ChainTemplate[]
}

/** Starting points for common parts; tweak them to taste. */
export const BUILT_IN_PRESETS: ChainPreset[] = [
  {
    name: 'Lead vocal',
    chain: [
      { type: 'gate', params: { threshold: -55, release: 120 } },
      { type: 'eq', params: { lowCut: 90, midGain: -2, midFreq: 350, midQ: 1.2, highGain: 3, highFreq: 9000 } },
      { type: 'compressor', params: { threshold: -20, ratio: 3, attack: 8, release: 120, makeup: 4 } },
      { type: 'reverb', params: { decay: 1.6, preDelay: 25, damping: 7000, mix: 18 } },
    ],
  },
  {
    name: 'Requinto / lead guitar',
    chain: [
      { type: 'eq', params: { lowCut: 140, midGain: 2, midFreq: 2500, highGain: 2, highFreq: 8000 } },
      { type: 'compressor', params: { threshold: -18, ratio: 3, attack: 15, release: 150, makeup: 2 } },
      { type: 'delay', params: { sync: '1/8d', feedback: 25, tone: 5000, mix: 15 } },
    ],
  },
  {
    name: 'Bass / tololoche',
    chain: [
      { type: 'eq', params: { lowCut: 35, lowGain: 3, lowFreq: 80, midGain: -2, midFreq: 300, highCut: 6000 } },
      { type: 'compressor', params: { threshold: -22, ratio: 4, attack: 20, release: 180, makeup: 3 } },
      { type: 'saturation', params: { drive: 8, tone: 6000, output: -4, mix: 30 } },
    ],
  },
  {
    name: 'Brass',
    chain: [
      { type: 'eq', params: { lowCut: 120, midGain: 2, midFreq: 1800, highGain: 1.5 } },
      { type: 'compressor', params: { threshold: -16, ratio: 2.5, attack: 12, release: 140, makeup: 2 } },
      { type: 'reverb', params: { decay: 2.2, preDelay: 15, mix: 20 } },
    ],
  },
  {
    name: 'Drum bus',
    chain: [
      { type: 'compressor', params: { threshold: -14, ratio: 4, attack: 25, release: 120, makeup: 3, mix: 60 } },
      { type: 'saturation', params: { drive: 6, tone: 14000, output: -3, mix: 25 } },
    ],
  },
  {
    name: 'Slap vocal',
    chain: [
      { type: 'eq', params: { lowCut: 100, highGain: 2, highFreq: 9000 } },
      { type: 'compressor', params: { threshold: -18, ratio: 3, attack: 10, release: 120, makeup: 3 } },
      { type: 'slapback', params: { time: 110, tone: 3500, mix: 22 } },
      { type: 'plate', params: { decay: 1.4, preDelay: 20, mix: 15 } },
    ],
  },
  {
    name: 'Wide pad',
    chain: [
      { type: 'chorus', params: { rate: 0.4, depth: 50, width: 90, mix: 45 } },
      { type: 'spread', params: { amount: 40, time: 14 } },
      { type: 'plate', params: { decay: 3, preDelay: 30, tone: 7000, mix: 30 } },
    ],
  },
  {
    name: 'Lo-fi keys',
    chain: [
      { type: 'tape', params: { wobble: 45, flutter: 25, wear: 50 } },
      { type: 'bitcrusher', params: { bits: 10, downsample: 2, mix: 40 } },
      { type: 'tilt', params: { tilt: -2.5, pivot: 900 } },
    ],
  },
  {
    name: 'Pumping bus',
    chain: [
      { type: 'duck', params: { rate: '1/4', depth: 65, release: 70 } },
      { type: 'clipper', params: { drive: 2, ceiling: -0.5, softness: 60 } },
    ],
  },
  {
    name: 'Vocal polish',
    chain: [
      { type: 'deesser', params: { freq: 6500, threshold: -32, range: 8 } },
      { type: 'opto', params: { peakReduction: 45, gain: 5 } },
      { type: 'air', params: { amount: 3, freq: 12000 } },
    ],
  },
  {
    name: 'Acoustic 12-string',
    chain: [
      { type: 'eq', params: { lowCut: 90, midGain: -2, midFreq: 300 } },
      { type: 'doubler', params: { octave: 65, detune: 7, spread: 75, mix: 50 } },
      { type: 'plate', params: { decay: 1.6, preDelay: 15, mix: 15 } },
    ],
  },
  {
    name: 'Punchy drums',
    chain: [
      { type: 'transient', params: { attack: 40, sustain: -20 } },
      { type: 'clipper', params: { drive: 3, ceiling: -1, softness: 50 } },
    ],
  },
  {
    name: 'Electric crunch',
    chain: [
      { type: 'amp', params: { drive: 24, bass: 2, mid: 3, treble: 1, cabinet: '4x12', output: -16 } },
      { type: 'slapback', params: { time: 95, tone: 3500, mix: 12 } },
    ],
  },
  {
    name: 'Glue bus',
    chain: [
      { type: 'compressor', params: { threshold: -12, ratio: 2, knee: 10, attack: 30, release: 200, makeup: 1 } },
      { type: 'saturation', params: { drive: 3, tone: 16000, output: -1.5, mix: 20 } },
    ],
  },
]

const STORAGE_KEY = 'monkey-daw:fx-presets:v1'

function load(): ChainPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((p) => typeof p?.name === 'string' && Array.isArray(p.chain)) : []
  } catch {
    return []
  }
}

function persist(presets: ChainPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // Storage unavailable; presets last for this session.
  }
}

export const useUserPresets = create<{ presets: ChainPreset[] }>()(() => ({ presets: load() }))

/** Saves a chain under a name, replacing any user preset with the same name. */
export function saveUserPreset(name: string, effects: Effect[]) {
  const preset: ChainPreset = {
    name: name.trim(),
    chain: effects.map((e) => ({ type: e.type, enabled: e.enabled, params: { ...e.params } })),
  }
  const presets = [...useUserPresets.getState().presets.filter((p) => p.name !== preset.name), preset]
  useUserPresets.setState({ presets })
  persist(presets)
}

export function deleteUserPreset(name: string) {
  const presets = useUserPresets.getState().presets.filter((p) => p.name !== name)
  useUserPresets.setState({ presets })
  persist(presets)
}
