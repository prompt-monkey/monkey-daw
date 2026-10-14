// Pattern generator: drums, chords, bass and a melody for a genre, in a key. Everything is
// derived from a seed, so "New variation" is just another seed and results are repeatable.
//
// Patterns are written per 16-step bar (sixteenth notes). Drum cells:
//   X accent · x hit · o soft · ? hit half the time · g ghost note now and then
//   r hit, sometimes doubled into a 1/32 roll · - rest
// Bass cells: r root · f fifth · o octave · ? root half the time · - rest.
// Chord and melody rhythms: x starts a chord; melody density is the chance of a note per 1/8.

import type { Note, SynthPreset } from '../model/types'
import { NOTE } from './kits'

export type GenreId = 'reggaeton' | 'trap' | 'trap-latino' | 'hiphop' | 'lofi' | 'ballad' | 'corrido' | 'rock'
export type GeneratedNote = Omit<Note, 'id'>
export type Scale = 'major' | 'minor'

interface Genre {
  label: string
  /** A typical tempo, shown as a hint. */
  tempo: number
  /** Delay of every second sixteenth, as a fraction of a sixteenth. */
  swing: number
  drums: Partial<Record<number, string>>
  /** Crash on the first beat. */
  crash?: boolean
  /** Tom and snare fill at the end of the last bar, now and then. */
  fill?: boolean
  chords: { rhythm: string; instrument: SynthPreset; seventh?: boolean }
  /** Chord roots as scale degrees (0 = the key's root), one chord per bar. */
  progressions: Record<Scale, number[][]>
  bass: string
  melody: { density: number; instrument: SynthPreset }
}

const POP = { major: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]], minor: [[0, 5, 2, 6], [0, 3, 6, 5], [0, 6, 5, 6]] }

export const GENRES: Record<GenreId, Genre> = {
  reggaeton: {
    label: 'Reggaeton',
    tempo: 95,
    swing: 0,
    drums: {
      [NOTE.kick]: 'X---x---X---x---',
      [NOTE.snare]: '---x--x----x--x-',
      [NOTE.hat]: 'x-?-x-?-x-?-x-?-',
      [NOTE.shaker]: 'g-g-g-g-g-g-g-g-',
      [NOTE.openHat]: '--------------?-',
    },
    chords: { rhythm: 'x-------x-------', instrument: 'pluck' },
    progressions: POP,
    bass: 'r--r--r-r--r--f-',
    melody: { density: 0.45, instrument: 'pluck' },
  },
  trap: {
    label: 'Trap',
    tempo: 140,
    swing: 0,
    drums: {
      [NOTE.kick]: 'X------x--x---?-',
      [NOTE.clap]: '--------X-------',
      [NOTE.hat]: 'xxrxxxrxxxrxxxrx',
      [NOTE.openHat]: '--------------?-',
    },
    chords: { rhythm: 'x---------------', instrument: 'pad' },
    progressions: { major: [[0, 4, 5, 3]], minor: [[0, 0, 5, 4], [0, 5, 3, 4], [0, 6, 5, 4]] },
    bass: 'r------r--r---?-',
    melody: { density: 0.35, instrument: 'lead' },
  },
  'trap-latino': {
    label: 'Trap latino',
    tempo: 90,
    swing: 0,
    drums: {
      [NOTE.kick]: 'X-----x---x--x--',
      [NOTE.clap]: '----x-------x---',
      [NOTE.hat]: 'x-xrx-x-x-xrx-x-',
      [NOTE.openHat]: '------?-------?-',
    },
    chords: { rhythm: 'x-------x-------', instrument: 'pluck' },
    progressions: POP,
    bass: 'r-----r---r--r--',
    melody: { density: 0.4, instrument: 'pluck' },
  },
  hiphop: {
    label: 'Hip hop',
    tempo: 90,
    swing: 0.15,
    drums: {
      [NOTE.kick]: 'X------x-x----?-',
      [NOTE.snare]: '----X-------X---',
      [NOTE.hat]: 'x-?-x-x-x-?-x-xg',
      [NOTE.openHat]: '------------?---',
    },
    fill: true,
    chords: { rhythm: 'x-------x-------', instrument: 'keys', seventh: true },
    progressions: { major: [[0, 3, 1, 4], [0, 5, 1, 4]], minor: [[0, 3, 6, 4], [0, 5, 3, 4]] },
    bass: 'r------r-r----f-',
    melody: { density: 0.3, instrument: 'keys' },
  },
  lofi: {
    label: 'Lo-fi',
    tempo: 80,
    swing: 0.25,
    drums: {
      [NOTE.kick]: 'X-----?-x-------',
      [NOTE.snare]: '----x-------x---',
      [NOTE.hat]: 'o-o-o-o-o-o-o-o-',
      [NOTE.rim]: '--g-----g---g---',
    },
    chords: { rhythm: 'x---------------', instrument: 'keys', seventh: true },
    progressions: { major: [[0, 5, 1, 4], [3, 2, 1, 4]], minor: [[0, 3, 6, 2], [0, 5, 3, 4]] },
    bass: 'r-------r-----f-',
    melody: { density: 0.25, instrument: 'keys' },
  },
  ballad: {
    label: 'Ballad',
    tempo: 70,
    swing: 0,
    drums: {
      [NOTE.kick]: 'x-------x-?-----',
      [NOTE.snare]: '----x-------x---',
      [NOTE.hat]: 'x---x---x---x---',
    },
    crash: true,
    fill: true,
    chords: { rhythm: 'x---------------', instrument: 'pad' },
    progressions: POP,
    bass: 'r-------f-------',
    melody: { density: 0.3, instrument: 'keys' },
  },
  corrido: {
    label: 'Corrido tumbado',
    tempo: 110,
    swing: 0,
    drums: {
      [NOTE.kick]: 'x-------x-------',
      [NOTE.rim]: '----x-------x---',
      [NOTE.hat]: '--x---x---x---x-',
      [NOTE.shaker]: 'g-?-g-?-g-?-g-?-',
    },
    chords: { rhythm: 'x---x---x---x---', instrument: 'pluck' },
    progressions: { major: [[0, 4, 4, 0], [0, 3, 4, 0]], minor: [[0, 4, 4, 0], [0, 3, 4, 0]] },
    bass: 'r-------f-------',
    melody: { density: 0.45, instrument: 'pluck' },
  },
  rock: {
    label: 'Rock',
    tempo: 120,
    swing: 0,
    drums: {
      [NOTE.kick]: 'X-x----xX-x---?-',
      [NOTE.snare]: '----X-------X---',
      [NOTE.hat]: 'x-x-x-x-x-x-x-x-',
    },
    crash: true,
    fill: true,
    chords: { rhythm: 'x-------x-------', instrument: 'lead' },
    progressions: { major: [[0, 4, 5, 3], [0, 3, 4, 3]], minor: [[0, 6, 5, 6], [0, 5, 6, 4]] },
    bass: 'r-r-r-r-r-r-r-r-',
    melody: { density: 0.3, instrument: 'lead' },
  },
}

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALES: Record<Scale, number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] }

/** Small, fast seeded random numbers (mulberry32), 0 ≤ x < 1. */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface GeneratorOptions {
  genre: GenreId
  /** Key root, 0 (C) to 11 (B). */
  key: number
  scale: Scale
  seed: number
}

export interface GeneratedPattern {
  drums: GeneratedNote[]
  chords: GeneratedNote[]
  melody: GeneratedNote[]
  bass: GeneratedNote[]
}

const STEP = 0.25
const mod = (n: number, m: number) => ((n % m) + m) % m

export function generatePattern(opts: GeneratorOptions, bars: number, stepsPerBar = 16): GeneratedPattern {
  const genre = GENRES[opts.genre]
  const rand = random(opts.seed)
  const scale = SCALES[opts.scale]
  const barBeats = stepsPerBar * STEP
  const cell = (pattern: string, step: number) => pattern[step % 16] ?? '-'
  const swingAt = (step: number) => (step % 2 === 1 ? genre.swing * STEP : 0)
  /** Pitch of a scale degree (any integer; 7 is the root an octave up) above `base`. */
  const degreePitch = (degree: number, base: number) => base + opts.key + scale[mod(degree, 7)] + 12 * Math.floor(degree / 7)

  // Drums.
  const drums: GeneratedNote[] = []
  const hit = (note: number, start: number, velocity: number) => drums.push({ pitch: note, start, length: STEP, velocity })
  const fillBar = genre.fill && rand() < 0.6 ? bars - 1 : -1
  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < stepsPerBar; step++) {
      const at = bar * barBeats + step * STEP + swingAt(step)
      const inFill = bar === fillBar && step >= stepsPerBar - 4
      for (const [noteKey, pattern] of Object.entries(genre.drums)) {
        const note = Number(noteKey)
        if (inFill && note !== NOTE.kick) continue
        const c = cell(pattern!, step)
        if (c === 'X') hit(note, at, 1)
        else if (c === 'x') hit(note, at, 0.8)
        else if (c === 'o') hit(note, at, 0.5)
        else if (c === '?' && rand() < 0.5) hit(note, at, 0.7)
        else if (c === 'g' && rand() < 0.35) hit(note, at, 0.35)
        else if (c === 'r') {
          hit(note, at, 0.75)
          if (rand() < 0.4) hit(note, at + STEP / 2, 0.55)
        }
      }
      if (inFill) {
        const toms = [NOTE.snare, NOTE.tomHigh, NOTE.tomMid, NOTE.tomLow]
        hit(toms[Math.min(3, Math.floor(((step - (stepsPerBar - 4)) / 4) * 4 + rand() * 1.5))], at, 0.85)
      }
    }
  }
  if (genre.crash) hit(NOTE.crash, 0, 0.9)

  // Chords: one per bar from a progression.
  const progression = genre.progressions[opts.scale][Math.floor(rand() * genre.progressions[opts.scale].length)]
  const chordRoot = (bar: number) => progression[bar % progression.length]
  const onsets = (pattern: string) => [...Array(stepsPerBar).keys()].filter((s) => cell(pattern, s) !== '-')
  const chords: GeneratedNote[] = []
  const chordSteps = onsets(genre.chords.rhythm)
  for (let bar = 0; bar < bars; bar++) {
    const root = chordRoot(bar)
    const tones = genre.chords.seventh ? [0, 2, 4, 6] : [0, 2, 4]
    chordSteps.forEach((step, i) => {
      const end = chordSteps[i + 1] ?? stepsPerBar
      for (const t of tones) {
        // Voice the chord around C3–C4 so it sits under the melody.
        let pitch = degreePitch(root + t, 48)
        if (degreePitch(root, 48) > 55) pitch -= 12
        chords.push({ pitch, start: bar * barBeats + step * STEP, length: (end - step) * STEP - 0.05, velocity: 0.6 })
      }
    })
  }

  // Bass: the chord root (or its fifth or octave) in the low register.
  const bass: GeneratedNote[] = []
  const bassSteps = onsets(genre.bass)
  for (let bar = 0; bar < bars; bar++) {
    const root = chordRoot(bar)
    bassSteps.forEach((step, i) => {
      const c = cell(genre.bass, step)
      if (c === '?' && rand() < 0.5) return
      const end = Math.min(bassSteps[i + 1] ?? stepsPerBar, step + 8)
      let pitch = degreePitch(c === 'f' ? root + 4 : root, 36) + (c === 'o' ? 12 : 0)
      if (pitch > 47) pitch -= 12
      bass.push({ pitch, start: bar * barBeats + step * STEP, length: (end - step) * STEP - 0.05, velocity: c === 'r' ? 0.85 : 0.75 })
    })
  }

  // Melody: a random walk on the scale, landing on chord tones on the beat.
  const melody: GeneratedNote[] = []
  let degree = 7 + [0, 2, 4][Math.floor(rand() * 3)]
  const starts: { start: number; degree: number }[] = []
  for (let bar = 0; bar < bars; bar++) {
    const root = chordRoot(bar)
    for (let step = 0; step < stepsPerBar; step += 2) {
      const onBeat = step % 4 === 0
      if (rand() >= genre.melody.density * (onBeat ? 1.3 : 0.8)) continue
      if (onBeat) {
        // Nearest chord tone to where the line is.
        const candidates = [0, 2, 4, 7, 9, 11, 14].map((t) => root + t).filter((d) => d >= 5 && d <= 15)
        degree = candidates.reduce((best, d) => (Math.abs(d - degree) < Math.abs(best - degree) ? d : best), candidates[0])
      } else {
        degree = Math.min(15, Math.max(5, degree + [-2, -1, -1, 1, 1, 2][Math.floor(rand() * 6)]))
      }
      starts.push({ start: bar * barBeats + step * STEP + swingAt(step), degree })
    }
  }
  starts.forEach(({ start, degree: d }, i) => {
    const next = starts[i + 1]?.start ?? bars * barBeats
    melody.push({ pitch: degreePitch(d, 48), start, length: Math.min(1, Math.max(0.5, next - start)) - 0.05, velocity: 0.7 + rand() * 0.25 })
  })

  return { drums, chords, melody, bass }
}
