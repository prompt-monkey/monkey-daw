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

// --- Auto-tune -----------------------------------------------------------------------------------

/**
 * YIN pitch detection on one block: the lag whose cumulative-mean-normalized difference first
 * dips under the threshold is the period. Returns the frequency, or null if the block isn't
 * clearly pitched (noise, breath, silence).
 */
export function detectPitch(x: Float32Array, sampleRate: number, minFreq = 70, maxFreq = 1000, threshold = 0.15): number | null {
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(x.length / 2))
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq))
  const window = x.length - maxLag
  if (window < minLag) return null
  const d = new Float32Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0
    for (let j = 0; j < window; j++) {
      const diff = x[j] - x[j + lag]
      sum += diff * diff
    }
    d[lag] = sum
  }
  // Cumulative mean normalized difference.
  let running = 0
  const cmnd = new Float32Array(maxLag + 1)
  cmnd[0] = 1
  for (let lag = 1; lag <= maxLag; lag++) {
    running += d[lag]
    cmnd[lag] = running > 0 ? (d[lag] * lag) / running : 1
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    if (cmnd[lag] >= threshold) continue
    // Walk down to the bottom of this dip, then refine between samples with a parabola.
    while (lag + 1 < maxLag && cmnd[lag + 1] < cmnd[lag]) lag++
    const a = cmnd[lag - 1]
    const b = cmnd[lag]
    const c = cmnd[lag + 1]
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1)
    return sampleRate / (lag + Math.max(-0.5, Math.min(0.5, shift)))
  }
  return null
}

/** Scales as the pitch classes they allow, counted from the key. */
export const SCALES: Record<string, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
}
export const SCALE_KEYS = Object.keys(SCALES)

/** The nearest note (as a fractional MIDI number's target) in a key and scale. */
export function nearestScaleNote(midi: number, key: number, scale: number[]): number {
  let best = Math.round(midi)
  let bestDistance = Infinity
  for (let n = Math.floor(midi) - 6; n <= Math.ceil(midi) + 6; n++) {
    if (!scale.includes((((n - key) % 12) + 12) % 12)) continue
    const distance = Math.abs(n - midi)
    if (distance < bestDistance) {
      bestDistance = distance
      best = n
    }
  }
  return best
}

/**
 * Pitch shifter for small, slowly changing ratios (pitch correction). One read head drifts
 * through a delay line at the ratio's speed; when it drifts too far it jumps back by a whole
 * number of periods of the sound, cross-fading over a few milliseconds. Jumping by whole periods
 * keeps the waveform aligned, so a sung note stays clean. With no period known it doesn't drift.
 */
export class SyncShifter {
  private buffer: Float32Array
  private write = 0
  private delay: number
  private nominal: number
  private range: number
  /** Second head during a cross-fade: its delay and the fade's progress (0…1). */
  private fade: { delay: number; progress: number; step: number } | null = null

  constructor(sampleRate: number) {
    this.nominal = Math.round(0.025 * sampleRate)
    this.range = Math.round(0.012 * sampleRate)
    this.delay = this.nominal
    this.buffer = new Float32Array(Math.round(0.1 * sampleRate))
  }

  private read(delay: number): number {
    const size = this.buffer.length
    const pos = this.write - 1 - delay
    const i = Math.floor(pos)
    const frac = pos - i
    const a = this.buffer[((i % size) + size) % size]
    const b = this.buffer[(((i + 1) % size) + size) % size]
    return a + (b - a) * frac
  }

  /** `period` is the sound's period in samples (null when unpitched). */
  next(x: number, ratio: number, period: number | null): number {
    this.buffer[this.write % this.buffer.length] = x
    this.write++
    const drift = period ? 1 - ratio : 0
    this.delay += drift
    let out = this.read(this.delay)
    if (this.fade) {
      this.fade.delay += drift
      const t = this.fade.progress
      out = out * (1 - t) + this.read(this.fade.delay) * t
      this.fade.progress += this.fade.step
      if (this.fade.progress >= 1) {
        this.delay = this.fade.delay
        this.fade = null
      }
    } else if (period && Math.abs(this.delay - this.nominal) > this.range) {
      // Jump toward the middle by whole periods.
      const periods = Math.max(1, Math.round(Math.abs(this.delay - this.nominal) / period))
      const target = this.delay + Math.sign(this.nominal - this.delay) * periods * period
      if (target > 2 && target < this.buffer.length - 2) {
        this.fade = { delay: target, progress: 0, step: 1 / Math.max(32, Math.min(period, 400)) }
      }
    }
    return out
  }
}

/**
 * Real-time pitch correction: detects the pitch (YIN on a 2× down-sampled copy, every ~12 ms),
 * snaps it to the nearest note of the key and scale, glides there at the retune speed, and
 * shifts the sound by the difference.
 */
export class AutoTuner {
  private sampleRate: number
  private analysisRate: number
  /** Ring buffer of the down-sampled signal, and the block handed to the detector. */
  private ring: Float32Array
  private ringWrite = 0
  private block: Float32Array
  private filled = 0
  private pending = 0
  private sinceAnalysis = 0
  private hop: number
  private shifter: SyncShifter
  private period: number | null = null
  private correction = 0
  private target = 0
  /** The last detected pitch and the note it is being pulled to (for display). */
  heard: { midi: number; target: number } | null = null

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.analysisRate = sampleRate / 2
    this.ring = new Float32Array(Math.round(this.analysisRate * 0.045))
    this.block = new Float32Array(this.ring.length)
    this.hop = Math.round(this.analysisRate * 0.012)
    this.shifter = new SyncShifter(sampleRate)
  }

  private analyse(key: number, scale: number[], amount: number) {
    // Oldest to newest.
    const n = this.ring.length
    this.block.set(this.ring.subarray(this.ringWrite), 0)
    this.block.set(this.ring.subarray(0, this.ringWrite), n - this.ringWrite)
    const f0 = detectPitch(this.block, this.analysisRate)
    let level = 0
    for (const v of this.block) level = Math.max(level, Math.abs(v))
    if (!f0 || level < 0.003) {
      this.period = null
      this.target = 0
      this.heard = null
      return
    }
    const midi = 69 + 12 * Math.log2(f0 / 440)
    const note = nearestScaleNote(midi, key, scale)
    this.period = this.sampleRate / f0
    this.target = (note - midi) * 100 * amount
    this.heard = { midi, target: note }
  }

  /** One sample, shifted; `retune` is in seconds (0 = instant), `amount` 0–1. */
  next(x: number, key: number, scale: number[], retune: number, amount: number): number {
    const { ratio, period } = this.step(x, key, scale, retune, amount)
    return this.shifter.next(x, ratio, period)
  }

  /**
   * Follows the pitch for one (mono) sample and returns the shift to apply now, so several
   * channels can each be shifted the same way with their own SyncShifter.
   */
  step(x: number, key: number, scale: number[], retune: number, amount: number): { ratio: number; period: number | null } {
    // Average pairs of samples into the analysis history (a simple 2× down-sample).
    this.pending += x
    if (++this.sinceAnalysis % 2 === 0) {
      this.ring[this.ringWrite] = this.pending / 2
      this.ringWrite = (this.ringWrite + 1) % this.ring.length
      this.pending = 0
      this.filled = Math.min(this.ring.length, this.filled + 1)
      if (this.filled === this.ring.length && (this.sinceAnalysis / 2) % this.hop === 0) this.analyse(key, scale, amount)
    }
    // Glide toward the target correction (in cents).
    const k = retune <= 0 ? 1 : 1 - Math.exp(-1 / (retune * this.sampleRate))
    this.correction += (this.target - this.correction) * k
    return { ratio: 2 ** (this.correction / 1200), period: this.period }
  }
}
