// Bitcrusher on the audio thread: holds each sample for `downsample` frames (a lower sample
// rate) and rounds it to `bits` of resolution.

declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class CrusherProcessor extends AudioWorkletProcessor {
  private held: number[] = []
  private counter = 0

  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 4, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
    ]
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      for (const channel of output) channel.fill(0)
      return true
    }
    const levels = 2 ** Math.floor(params.bits[0]) / 2
    const hold = Math.max(1, Math.round(params.downsample[0]))
    const frames = input[0].length
    for (let i = 0; i < frames; i++) {
      const take = this.counter === 0
      this.counter = (this.counter + 1) % hold
      for (let c = 0; c < output.length; c++) {
        const x = input[Math.min(c, input.length - 1)][i]
        if (take) this.held[c] = Math.round(x * levels) / levels
        output[c][i] = this.held[c] ?? 0
      }
    }
    return true
  }
}

registerProcessor('monkey-daw-crusher', CrusherProcessor)
