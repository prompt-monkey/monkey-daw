// Sample-by-sample processors for effects batch 3. They run inside an AudioWorklet (see
// specialist.worklet.ts) but have no Web Audio dependencies, so they are unit-tested directly.

const dbToGain = (db: number) => 10 ** (db / 20)
const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-9))
/** One-pole smoothing coefficient for a time constant in seconds. */
const coefficient = (seconds: number, sampleRate: number) => 1 - Math.exp(-1 / (Math.max(seconds, 1e-5) * sampleRate))

/** Peak envelope follower with separate attack and release times. */
export class Envelope {
  private value = 0
  private attack: number
  private release: number

  constructor(attack: number, release: number, sampleRate: number) {
    this.attack = coefficient(attack, sampleRate)
    this.release = coefficient(release, sampleRate)
  }

  next(level: number): number {
    this.value += (level - this.value) * (level > this.value ? this.attack : this.release)
    return this.value
  }
}

/**
 * Transient shaper: boosts or softens the attack and the sustain of each hit, independent of
 * level. A fast and a slow envelope tell attacks apart (the fast one leads); a short and a long
 * release tell the sustain apart (the long one lingers).
 */
export class TransientShaper {
  private fast: Envelope
  private slow: Envelope
  private shortTail: Envelope
  private longTail: Envelope

  constructor(sampleRate: number) {
    this.fast = new Envelope(0.0005, 0.05, sampleRate)
    this.slow = new Envelope(0.02, 0.05, sampleRate)
    this.shortTail = new Envelope(0.001, 0.03, sampleRate)
    this.longTail = new Envelope(0.001, 0.4, sampleRate)
  }

  /** Gain for one frame; `attack` and `sustain` are −1…1. */
  gain(level: number, attack: number, sustain: number): number {
    const onset = Math.max(0, gainToDb(this.fast.next(level)) - gainToDb(this.slow.next(level)))
    const tail = Math.max(0, gainToDb(this.longTail.next(level)) - gainToDb(this.shortTail.next(level)))
    // At most +12 dB of boost: enough punch without turning every hit into a click.
    const db = Math.min(12, Math.max(-24, attack * Math.min(onset, 12) + sustain * Math.min(tail, 24)))
    return dbToGain(db)
  }
}

/**
 * De-esser: splits off the highs above `freq` (low = the signal through two one-pole low-passes,
 * high = the rest, so low + high always add back up exactly) and turns only the highs down while
 * they are louder than the threshold.
 */
export class DeEsser {
  private sampleRate: number
  private lowState: number[] = []
  private lowState2: number[] = []
  private detector: Envelope
  private reduction = 1

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.detector = new Envelope(0.001, 0.06, sampleRate)
  }

  /** Processes one frame of all channels in place. */
  frame(samples: number[], freq: number, thresholdDb: number, rangeDb: number): void {
    const a = 1 - Math.exp((-2 * Math.PI * freq) / this.sampleRate)
    let level = 0
    const highs = samples.map((x, c) => {
      const first = (this.lowState[c] ?? 0) + a * (x - (this.lowState[c] ?? 0))
      this.lowState[c] = first
      const low = (this.lowState2[c] ?? 0) + a * (first - (this.lowState2[c] ?? 0))
      this.lowState2[c] = low
      const high = x - low
      level = Math.max(level, Math.abs(high))
      return high
    })
    const env = this.detector.next(level)
    const over = gainToDb(env) - thresholdDb
    // Like a compressor with a high ratio, limited to `range` dB of reduction.
    const target = over > 0 ? dbToGain(-Math.min(rangeDb, over * 0.8)) : 1
    this.reduction += (target - this.reduction) * (target < this.reduction ? 0.05 : 0.002)
    for (let c = 0; c < samples.length; c++) samples[c] = samples[c] - highs[c] + highs[c] * this.reduction
  }

  /** Current gain on the highs (1 = untouched). */
  get gainReduction(): number {
    return this.reduction
  }
}

/**
 * Optical-style compressor: one knob sets how hard it works. Gentle ratio and knee, and a
 * two-stage release (half recovers quickly, half slowly), like a photocell that remembers.
 */
export class OptoCompressor {
  private detector: Envelope
  private fastGr = 0
  private slowGr = 0
  private attack: number
  private fastRelease: number
  private slowRelease: number

  constructor(sampleRate: number) {
    this.detector = new Envelope(0.002, 0.08, sampleRate)
    this.attack = coefficient(0.01, sampleRate)
    this.fastRelease = coefficient(0.06, sampleRate)
    this.slowRelease = coefficient(1.5, sampleRate)
  }

  /** Gain for one frame; `peakReduction` is 0–1. */
  gain(level: number, peakReduction: number): number {
    const threshold = -6 - 34 * peakReduction
    const db = gainToDb(this.detector.next(level))
    // 3:1 with a 10 dB soft knee.
    const over = db - threshold
    const knee = 10
    const target = over <= -knee / 2 ? 0 : over >= knee / 2 ? over * (2 / 3) : ((over + knee / 2) ** 2 / (2 * knee)) * (2 / 3)
    const step = (gr: number, release: number) => gr + (target - gr) * (target > gr ? this.attack : release)
    this.fastGr = step(this.fastGr, this.fastRelease)
    this.slowGr = step(this.slowGr, this.slowRelease)
    return dbToGain(-(this.fastGr + this.slowGr) / 2)
  }
}

/**
 * Pitch shifter: two read heads sweep a delay line and cross-fade (sin² windows that always sum
 * to 1), so the audio plays back faster or slower without changing length. Simple and light;
 * it can sound grainy on big shifts.
 */
export class PitchShifter {
  private buffer: Float32Array
  private write = 0
  private phase = 0
  private window: number

  constructor(sampleRate: number, windowSeconds = 0.04) {
    this.window = Math.round(windowSeconds * sampleRate)
    this.buffer = new Float32Array(this.window * 2 + 4)
  }

  private read(delay: number): number {
    const size = this.buffer.length
    const pos = this.write - delay
    const i = Math.floor(pos)
    const frac = pos - i
    const a = this.buffer[((i % size) + size) % size]
    const b = this.buffer[(((i + 1) % size) + size) % size]
    return a + (b - a) * frac
  }

  /** Shifts by `ratio` (2 = an octave up); returns the shifted sample. */
  next(x: number, ratio: number): number {
    this.buffer[this.write % this.buffer.length] = x
    this.write++
    // The delay shrinks by (ratio − 1) samples per sample when shifting up, grows when down.
    this.phase = (((this.phase - (ratio - 1) / this.window) % 1) + 1) % 1
    const p2 = (this.phase + 0.5) % 1
    const g1 = Math.sin(Math.PI * this.phase) ** 2
    const g2 = Math.sin(Math.PI * p2) ** 2
    return g1 * this.read(this.phase * this.window + 1) + g2 * this.read(p2 * this.window + 1)
  }
}

/**
 * 12-string doubler: an octave-up copy (the high courses of a 12-string) and a slightly
 * detuned unison copy, placed apart in the stereo field. Returns only the doubled parts.
 */
export class Doubler {
  private octave: PitchShifter
  private unison: PitchShifter

  constructor(sampleRate: number) {
    this.octave = new PitchShifter(sampleRate, 0.03)
    this.unison = new PitchShifter(sampleRate, 0.05)
  }

  /** Wet left and right for one mono input sample. */
  next(x: number, octaveLevel: number, detuneCents: number, spread: number): [number, number] {
    const oct = this.octave.next(x, 2) * octaveLevel
    const uni = this.unison.next(x, 2 ** (detuneCents / 1200))
    // Octave toward the left, unison toward the right, equal-power.
    const octAngle = (Math.PI / 4) * (1 - spread)
    const uniAngle = (Math.PI / 4) * (1 + spread)
    return [oct * Math.cos(octAngle) + uni * Math.cos(uniAngle), oct * Math.sin(octAngle) + uni * Math.sin(uniAngle)]
  }
}
