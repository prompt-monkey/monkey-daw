// AudioWorklet processors for the creative effects with feedback loops. The DSP lives in
// creative-dsp.ts; these classes only move samples between Web Audio and it.

import { Crystal, TapeEcho } from './creative-dsp'

declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {}

type Params = Record<string, Float32Array>

const kRate = (name: string, defaultValue: number, minValue: number, maxValue: number) => ({
  name,
  defaultValue,
  minValue,
  maxValue,
  automationRate: 'k-rate',
})

/** Runs one processor per output channel; mono input feeds both sides. */
function perChannel<T>(inputs: Float32Array[][], outputs: Float32Array[][], units: T[], step: (unit: T, x: number) => number): boolean {
  const input = inputs[0]
  const output = outputs[0]
  for (let c = 0; c < output.length; c++) {
    const src = input && input.length ? input[Math.min(c, input.length - 1)] : null
    const out = output[c]
    for (let i = 0; i < out.length; i++) out[i] = step(units[c], src ? src[i] : 0)
  }
  return true
}

class CrystalProcessor extends AudioWorkletProcessor {
  private units = [new Crystal(sampleRate), new Crystal(sampleRate)]

  static get parameterDescriptors() {
    return [kRate('shift', 12, -12, 12), kRate('splice', 250, 60, 500), kRate('feedback', 45, 0, 85)]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const shift = params.shift[0]
    const splice = params.splice[0] / 1000
    const feedback = params.feedback[0] / 100
    return perChannel(inputs, outputs, this.units, (unit, x) => unit.next(x, shift, splice, feedback))
  }
}

class TapeEchoProcessor extends AudioWorkletProcessor {
  private units = [new TapeEcho(sampleRate), new TapeEcho(sampleRate, 1.3)]

  static get parameterDescriptors() {
    return [kRate('time', 0.32, 0.05, 1), kRate('feedback', 45, 0, 80), kRate('warp', 40, 0, 100), kRate('shift', 0, -24, 24)]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params) {
    const time = params.time[0]
    const feedback = params.feedback[0] / 100
    const warp = params.warp[0] / 100
    const shift = params.shift[0]
    return perChannel(inputs, outputs, this.units, (unit, x) => unit.next(x, time, feedback, warp, shift))
  }
}

registerProcessor('monkey-daw-crystal', CrystalProcessor)
registerProcessor('monkey-daw-tape-echo', TapeEchoProcessor)
