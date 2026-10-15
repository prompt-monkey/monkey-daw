// Drum kits: the 16-pad layout and the kit presets. Every preset uses the same pads (General
// MIDI drum notes), so a pattern keeps playing on the same pads when the kit changes.

import type { DrumKit, DrumPad, DrumVoice } from '../model/types'

type PadTemplate = Pick<DrumPad, 'note' | 'name' | 'voice'> & Partial<Pick<DrumPad, 'choke'>>

/** Pad layout, in pad-grid and step-sequencer order. */
export const PADS: PadTemplate[] = [
  { note: 36, name: 'Kick', voice: 'kick' },
  { note: 38, name: 'Snare', voice: 'snare' },
  { note: 39, name: 'Clap', voice: 'clap' },
  { note: 37, name: 'Rim', voice: 'rim' },
  // The hi-hats choke each other, like a real hi-hat.
  { note: 42, name: 'Closed hat', voice: 'hat-closed', choke: 1 },
  { note: 46, name: 'Open hat', voice: 'hat-open', choke: 1 },
  { note: 49, name: 'Crash', voice: 'crash' },
  { note: 51, name: 'Ride', voice: 'ride' },
  { note: 35, name: 'Sub kick', voice: 'sub' },
  { note: 45, name: 'Low tom', voice: 'tom-low' },
  { note: 47, name: 'Mid tom', voice: 'tom-mid' },
  { note: 50, name: 'High tom', voice: 'tom-high' },
  { note: 56, name: 'Cowbell', voice: 'cowbell' },
  { note: 70, name: 'Shaker', voice: 'shaker' },
  { note: 64, name: 'Low conga', voice: 'conga-low' },
  { note: 63, name: 'High conga', voice: 'conga-high' },
]

export const DRUM_VOICES: DrumVoice[] = [...new Set(PADS.map((p) => p.voice))]

/** Pad notes by name, for patterns and presets. */
export const NOTE = {
  kick: 36,
  snare: 38,
  clap: 39,
  rim: 37,
  hat: 42,
  openHat: 46,
  crash: 49,
  ride: 51,
  sub: 35,
  tomLow: 45,
  tomMid: 47,
  tomHigh: 50,
  cowbell: 56,
  shaker: 70,
  congaLow: 64,
  congaHigh: 63,
} as const

type PadSettings = Partial<Pick<DrumPad, 'tune' | 'decay' | 'gain'>>

interface KitPreset {
  id: string
  name: string
  description: string
  pads: Partial<Record<number, PadSettings>>
}

export const KIT_PRESETS: KitPreset[] = [
  { id: 'standard', name: 'Standard', description: 'A balanced, all-round kit', pads: {} },
  {
    id: 'trap',
    name: 'Trap',
    description: 'Long sub kick, tight snare and crisp hats',
    pads: {
      [NOTE.kick]: { tune: -2, decay: 0.8 },
      [NOTE.sub]: { decay: 2.5, gain: 1.2 },
      [NOTE.snare]: { tune: 3, decay: 0.8 },
      [NOTE.clap]: { decay: 1.3, gain: 1.1 },
      [NOTE.hat]: { tune: 2, decay: 0.7, gain: 0.8 },
      [NOTE.openHat]: { tune: 2, decay: 0.8 },
    },
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    description: 'Soft, short and dusty',
    pads: {
      [NOTE.kick]: { tune: -1, decay: 0.8, gain: 0.9 },
      [NOTE.snare]: { tune: -3, decay: 0.7, gain: 0.8 },
      [NOTE.hat]: { tune: -4, decay: 0.8, gain: 0.6 },
      [NOTE.openHat]: { tune: -4, decay: 0.6, gain: 0.6 },
      [NOTE.rim]: { tune: -2, gain: 0.8 },
      [NOTE.ride]: { tune: -3, decay: 0.7, gain: 0.6 },
    },
  },
  {
    id: 'latin',
    name: 'Latin',
    description: 'Punchy kick and snare, bright percussion',
    pads: {
      [NOTE.kick]: { tune: 1, decay: 0.9 },
      [NOTE.snare]: { tune: 2, decay: 0.9 },
      [NOTE.rim]: { tune: 2, gain: 1.1 },
      [NOTE.cowbell]: { tune: 1 },
      [NOTE.shaker]: { gain: 1.1 },
      [NOTE.congaLow]: { gain: 1.1 },
      [NOTE.congaHigh]: { gain: 1.1 },
    },
  },
  {
    id: 'rock',
    name: 'Rock',
    description: 'Big kick, long snare, open cymbals',
    pads: {
      [NOTE.kick]: { tune: -1, decay: 1.2, gain: 1.1 },
      [NOTE.snare]: { tune: -1, decay: 1.5, gain: 1.1 },
      [NOTE.crash]: { decay: 1.4 },
      [NOTE.ride]: { decay: 1.3 },
      [NOTE.tomLow]: { decay: 1.4 },
      [NOTE.tomMid]: { decay: 1.4 },
      [NOTE.tomHigh]: { decay: 1.4 },
    },
  },
]

export const presetName = (id: string) => KIT_PRESETS.find((p) => p.id === id)?.name ?? 'Custom'

/** A kit from a preset: every pad synthesized, with the preset's tuning and levels. */
export function createKit(presetId = 'standard'): DrumKit {
  const preset = KIT_PRESETS.find((p) => p.id === presetId) ?? KIT_PRESETS[0]
  return {
    preset: preset.id,
    pads: PADS.map((pad) => ({ ...pad, tune: 0, decay: 1, gain: 1, choke: pad.choke ?? 0, ...preset.pads[pad.note] })),
  }
}
