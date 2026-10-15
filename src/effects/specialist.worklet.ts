// AudioWorklet processors for effects batch 3. The DSP lives in specialist-dsp.ts; these classes
// only move samples between Web Audio and it.

import { AutoTuner, DeEsser, Doubler, OptoCompressor, SCALES, SCALE_KEYS, SyncShifter, TransientShaper } from './specialist-dsp'

declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

type Params = Record<string, Float32Array>

const kRate = (name: string, defaultValue: number, minValue: number, maxValue: number) => ({
  name,
  defaultValue,
  minValue,
  maxValue,
  automationRate: 'k-rate',
})

/** Runs `perFrame` with each frame's peak level, multiplying every channel by its gain. */
function applyGain(inputs: Float32Array[][], outputs: Float32Array[][], perFrame: (level: number) => number): boolean {
  const input = inputs[0]
  const output = outputs[0]
  if (!input || input.length === 0) {
    for (const channel of output) channel.fill(0)
    return true
  }
  for (let i = 0; i < input[0].length; i++) {
    let level = 0
    for (const channel of input) level = Math.max(level, Math.abs(channel[i]))
    const g = perFrame(level)
    for (let c = 0; c < output.length; c++) output[c][i] = input[Math.min(c, input.length - 1)][i] * g
  }
  return true
}

class TransientProcessor extends AudioWorkletProcessor {
  private shaper = new TransientShaper(sampleRate)

  static get parameterDescriptors() {
    return [kRate('attack', 0, -100, 100), kRate('sustain', 0, -100, 100)]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const attack = params.attack[0] / 100
    const sustain = params.sustain[0] / 100
    return applyGain(inputs, outputs, (level) => this.shaper.gain(level, attack, sustain))
  }
}

class OptoProcessor extends AudioWorkletProcessor {
  private comp = new OptoCompressor(sampleRate)

  static get parameterDescriptors() {
    return [kRate('peakReduction', 40, 0, 100)]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const amount = params.peakReduction[0] / 100
    return applyGain(inputs, outputs, (level) => this.comp.gain(level, amount))
  }
}

class DeEsserProcessor extends AudioWorkletProcessor {
  private deesser = new DeEsser(sampleRate)

  static get parameterDescriptors() {
    return [kRate('freq', 6000, 2000, 16000), kRate('threshold', -30, -60, 0), kRate('range', 10, 0, 24)]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      for (const channel of output) channel.fill(0)
      return true
    }
    const frame: number[] = []
    for (let i = 0; i < input[0].length; i++) {
      for (let c = 0; c < output.length; c++) frame[c] = input[Math.min(c, input.length - 1)][i]
      this.deesser.frame(frame, params.freq[0], params.threshold[0], params.range[0])
      for (let c = 0; c < output.length; c++) output[c][i] = frame[c]
    }
    return true
  }
}

class DoublerProcessor extends AudioWorkletProcessor {
  private doubler = new Doubler(sampleRate)

  static get parameterDescriptors() {
    return [kRate('octave', 60, 0, 100), kRate('detune', 8, 0, 30), kRate('spread', 70, 0, 100)]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const input = inputs[0]
    const [left, right] = outputs[0]
    if (!input || input.length === 0) {
      left.fill(0)
      right?.fill(0)
      return true
    }
    const octave = params.octave[0] / 100
    const detune = params.detune[0]
    const spread = params.spread[0] / 100
    for (let i = 0; i < input[0].length; i++) {
      let mono = 0
      for (const channel of input) mono += channel[i] / input.length
      const [l, r] = this.doubler.next(mono, octave, detune, spread)
      left[i] = l
      if (right) right[i] = r
    }
    return true
  }
}

class AutoTuneProcessor extends AudioWorkletProcessor {
  private tuner = new AutoTuner(sampleRate)
  private shifters: SyncShifter[] = []

  static get parameterDescriptors() {
    return [
      kRate('key', 0, 0, 11),
      kRate('scale', 0, 0, SCALE_KEYS.length - 1),
      kRate('retune', 40, 0, 400),
      kRate('amount', 100, 0, 100),
    ]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      for (const channel of output) channel.fill(0)
      return true
    }
    const key = Math.round(params.key[0])
    const scale = SCALES[SCALE_KEYS[Math.round(params.scale[0])]] ?? SCALES.chromatic
    const retune = params.retune[0] / 1000
    const amount = params.amount[0] / 100
    while (this.shifters.length < output.length) this.shifters.push(new SyncShifter(sampleRate))
    for (let i = 0; i < input[0].length; i++) {
      let mono = 0
      for (const channel of input) mono += channel[i] / input.length
      const { ratio, period } = this.tuner.step(mono, key, scale, retune, amount)
      for (let c = 0; c < output.length; c++) output[c][i] = this.shifters[c].next(input[Math.min(c, input.length - 1)][i], ratio, period)
    }
    return true
  }
}

registerProcessor('monkey-daw-transient', TransientProcessor)
registerProcessor('monkey-daw-autotune', AutoTuneProcessor)
registerProcessor('monkey-daw-opto', OptoProcessor)
registerProcessor('monkey-daw-deesser', DeEsserProcessor)
registerProcessor('monkey-daw-doubler', DoublerProcessor)
