// DSP for the creative effects that need sample-level feedback loops: the crystal shimmer and the
// tape echo. Pure classes, run per channel by creative.worklet.ts and tested directly.

/** One-pole low-pass coefficient for a cutoff. */
const onePole = (hz: number, sampleRate: number) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate)

/** A ring buffer read at fractional delays. */
class DelayLine {
  private buffer: Float32Array
  private write = 0

  constructor(maxSamples: number) {
    this.buffer = new Float32Array(Math.ceil(maxSamples) + 4)
  }

  push(x: number) {
    this.buffer[this.write] = x
    this.write = (this.write + 1) % this.buffer.length
  }

  /** The sample written `delay` samples ago (1 = the last one pushed). */
  read(delay: number): number {
    const size = this.buffer.length
    const d = Math.min(size - 2, Math.max(1, delay))
    const pos = this.write - d
    const i = Math.floor(pos)
    const frac = pos - i
    const a = this.buffer[((i % size) + size) % size]
    const b = this.buffer[(((i + 1) % size) + size) % size]
    return a + (b - a) * frac
  }
}

/**
 * Pitch shifter with a grain length that can change while it runs: two read heads sweep a delay
 * line half a grain apart and cross-fade with sin² windows that sum to 1.
 */
export class GrainShifter {
  private line: DelayLine
  private phase = 0

  constructor(sampleRate: number, maxGrainSeconds: number) {
    this.line = new DelayLine(maxGrainSeconds * sampleRate + 2)
  }

  /** Shifts by `ratio` (2 = an octave up) with grains of `grain` samples. */
  next(x: number, ratio: number, grain: number): number {
    this.line.push(x)
    this.phase = (((this.phase - (ratio - 1) / grain) % 1) + 1) % 1
    const p2 = (this.phase + 0.5) % 1
    const g1 = Math.sin(Math.PI * this.phase) ** 2
    const g2 = Math.sin(Math.PI * p2) ** 2
    return g1 * this.line.read(this.phase * grain + 1) + g2 * this.line.read(p2 * grain + 1)
  }
}

export const semitoneRatio = (semitones: number) => 2 ** (Math.round(semitones) / 12)

/** Longest splice of the crystal effect, in seconds. */
export const CRYSTAL_MAX_SPLICE = 0.5

/**
 * Crystal shimmer: the input is pitch-shifted in splices, delayed by one splice, softened above
 * 9 kHz and fed back into the shifter, so every repeat climbs (or falls) another step.
 * Returns only the wet signal.
 */
export class Crystal {
  private shifter: GrainShifter
  private delay: DelayLine
  private lp = 0
  private a: number
  private sampleRate: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.shifter = new GrainShifter(sampleRate, CRYSTAL_MAX_SPLICE)
    this.delay = new DelayLine(CRYSTAL_MAX_SPLICE * sampleRate + 2)
    this.a = onePole(9000, sampleRate)
  }

  /** `shift` in semitones, `splice` in seconds, `feedback` 0–1. */
  next(x: number, shift: number, splice: number, feedback: number): number {
    const grain = Math.max(32, Math.min(CRYSTAL_MAX_SPLICE, splice) * this.sampleRate)
    const shifted = this.shifter.next(x + this.lp * feedback, semitoneRatio(shift), grain)
    this.delay.push(shifted)
    this.lp += (this.delay.read(grain) - this.lp) * this.a
    return this.lp
  }
}

/** Shortest and longest tape echo times, in seconds (the shortest stays clear of the wobble). */
export const TAPE_ECHO_MIN = 0.05
export const TAPE_ECHO_MAX = 1

/**
 * Tape echo: a delay whose read head wobbles (slow wow, fast flutter), with a loop that loses
 * lows and highs and saturates on every pass. `shift` pitch-shifts the repeats, so each echo
 * lands higher or lower than the one before. Returns only the wet signal.
 */
export class TapeEcho {
  private line: DelayLine
  private shifter: GrainShifter
  private wow = 0
  private flutter = 0
  private hpLow = 0
  private lp = 0
  private loop = 0
  private hpA: number
  private sampleRate: number

  constructor(sampleRate: number, phase = 0) {
    this.sampleRate = sampleRate
    this.line = new DelayLine((TAPE_ECHO_MAX + 0.01) * sampleRate)
    this.shifter = new GrainShifter(sampleRate, 0.08)
    this.hpA = onePole(180, sampleRate)
    // The second channel's wobble runs a little out of step, which widens the echoes.
    this.wow = phase
    this.flutter = phase * 3
  }

  /** `time` in seconds, `feedback` and `warp` 0–1, `shift` in semitones. */
  next(x: number, time: number, feedback: number, warp: number, shift: number): number {
    const sr = this.sampleRate
    this.wow += (2 * Math.PI * 0.6) / sr
    this.flutter += (2 * Math.PI * 5.5) / sr
    if (this.wow > 2 * Math.PI) this.wow -= 2 * Math.PI
    if (this.flutter > 2 * Math.PI) this.flutter -= 2 * Math.PI
    const wobble = warp * (0.006 * Math.sin(this.wow) + 0.0006 * Math.sin(this.flutter))
    this.line.push(x + this.loop * feedback)
    let y = this.line.read((Math.min(TAPE_ECHO_MAX, Math.max(TAPE_ECHO_MIN, time)) + wobble) * sr)
    // Thin lows and dull highs (more with warp), then gentle tape saturation.
    this.hpLow += (y - this.hpLow) * this.hpA
    y -= this.hpLow
    this.lp += (y - this.lp) * onePole(4200 - 1800 * warp, sr)
    y = Math.tanh(2 * this.lp) / 2
    this.loop = Math.round(shift) === 0 ? y : this.shifter.next(y, semitoneRatio(shift), 0.08 * sr)
    return y
  }
}
