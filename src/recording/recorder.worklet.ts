// Runs on the audio thread: copies input samples while recording and sends them to the main
// thread in batches, each stamped with the audio clock time of its first sample.

declare const currentTime: number
declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

/** Samples per message (~46 ms at 44.1 kHz): few messages, low memory churn. */
const BATCH = 2048

class RecorderProcessor extends AudioWorkletProcessor {
  private recording = false
  private batch: Float32Array[] = []
  private filled = 0
  private batchTime = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<'start' | 'stop'>) => {
      if (e.data === 'start') {
        this.recording = true
        this.filled = 0
        this.batch = []
      } else {
        this.flush()
        this.recording = false
        this.port.postMessage({ type: 'stopped', sampleRate })
      }
    }
  }

  private flush() {
    if (!this.filled) return
    const channels = this.batch.map((c) => c.slice(0, this.filled))
    this.port.postMessage({ type: 'chunk', time: this.batchTime, channels }, channels.map((c) => c.buffer))
    this.filled = 0
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0]
    if (!this.recording || !input || input.length === 0) return true
    if (this.batch.length !== input.length) {
      this.flush()
      this.batch = input.map(() => new Float32Array(BATCH))
    }
    const frames = input[0].length
    if (this.filled === 0) this.batchTime = currentTime
    if (this.filled + frames > BATCH) {
      this.flush()
      this.batchTime = currentTime
    }
    input.forEach((data, c) => this.batch[c].set(data, this.filled))
    this.filled += frames
    return true
  }
}

registerProcessor('monkey-daw-recorder', RecorderProcessor)
