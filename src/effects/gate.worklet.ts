// Noise gate on the audio thread: opens when the level rises above the threshold and closes
// (down to `range`) when it falls 3 dB below it, with smooth attack and release.

declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

/** Closing point below the threshold, so the gate doesn't chatter around it (≈ -3 dB). */
const HYSTERESIS = 0.7
/** Decay of the level detector, in seconds. */
const DETECTOR_RELEASE = 0.01

const dbToGain = (db: number) => 10 ** (db / 20)
const coefficient = (seconds: number) => 1 - Math.exp(-1 / (Math.max(seconds, 1e-5) * sampleRate))

class GateProcessor extends AudioWorkletProcessor {
  private envelope = 0
  private gain = 0
  private open = false

  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 1, minValue: 0.01, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 100, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'range', defaultValue: -80, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
    ]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      for (const channel of output) channel.fill(0)
      return true
    }
    const threshold = dbToGain(params.threshold[0])
    const closed = dbToGain(params.range[0])
    const attack = coefficient(params.attack[0] / 1000)
    const release = coefficient(params.release[0] / 1000)
    const detectorDecay = Math.exp(-1 / (DETECTOR_RELEASE * sampleRate))
    const frames = input[0].length
    for (let i = 0; i < frames; i++) {
      let level = 0
      for (const channel of input) level = Math.max(level, Math.abs(channel[i]))
      this.envelope = Math.max(level, this.envelope * detectorDecay)
      if (this.envelope >= threshold) this.open = true
      else if (this.envelope < threshold * HYSTERESIS) this.open = false
      const target = this.open ? 1 : closed
      this.gain += (target - this.gain) * (target > this.gain ? attack : release)
      for (let c = 0; c < output.length; c++) output[c][i] = input[Math.min(c, input.length - 1)][i] * this.gain
    }
    return true
  }
}

registerProcessor('monkey-daw-gate', GateProcessor)
