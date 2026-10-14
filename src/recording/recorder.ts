// Audio input: opens a device (or any MediaStream), meters it, and captures raw samples through
// an AudioWorklet so every sample has an exact audio clock time.

import type { MeterReading } from '../audio/graph'
import workletUrl from './recorder.worklet.ts?worker&url'
import type { RecordedChunk } from './take'

export class RecordingUnavailableError extends Error {}

/** Recording isn't available on iPhone/iPad browsers (WebKit input limits). */
export function recordingSupported(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  return !ios && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== 'undefined'
}

/** Human-readable reason for a getUserMedia failure. */
export function inputErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access is blocked. Allow it in the site settings (the icon left of the address bar) and try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No audio input was found. Connect a microphone or interface.'
  if (name === 'NotReadableError') return 'The audio input is in use by another app or could not be opened.'
  return err instanceof Error ? err.message : 'The audio input could not be opened.'
}

const loadedContexts = new WeakSet<BaseAudioContext>()

export class Recorder {
  private ctx: AudioContext
  private stream: MediaStream | null = null
  private ownsStream = false
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private analysers: AnalyserNode[] = []
  private meterData = new Float32Array(1024)
  private chunks: RecordedChunk[] = []
  private stopped: ((sampleRate: number) => void) | null = null
  /** Called for each recorded chunk, for live drawing. */
  onChunk: ((chunk: RecordedChunk) => void) | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  get isOpen(): boolean {
    return this.stream !== null
  }

  /** Input latency the device reports, in seconds (0 if unknown). */
  get inputLatency(): number {
    const settings = this.stream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined
    return settings?.latency ?? 0
  }

  /** Opens an input device by id (or the default one). */
  async openDevice(deviceId: string | null): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Processing meant for calls would colour and duck a musical recording.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    })
    await this.openStream(stream, true)
  }

  /** Uses an existing stream as the input (also how tests feed synthetic audio in). */
  async openStream(stream: MediaStream, owned = false): Promise<void> {
    this.close()
    if (!loadedContexts.has(this.ctx)) {
      await this.ctx.audioWorklet.addModule(workletUrl)
      loadedContexts.add(this.ctx)
    }
    this.stream = stream
    this.ownsStream = owned
    this.source = this.ctx.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(this.ctx, 'monkey-daw-recorder', { numberOfInputs: 1, numberOfOutputs: 1 })
    // The node has to reach the destination to keep running; a silent gain stops it being heard.
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination)

    const splitter = this.ctx.createChannelSplitter(2)
    this.source.connect(splitter)
    this.analysers = [0, 1].map((i) => {
      const a = this.ctx.createAnalyser()
      a.fftSize = 1024
      splitter.connect(a, i)
      return a
    })

    this.node.port.onmessage = (e: MessageEvent<{ type: 'chunk'; time: number; channels: Float32Array[] } | { type: 'stopped'; sampleRate: number }>) => {
      if (e.data.type === 'chunk') {
        const chunk = { time: e.data.time, channels: e.data.channels }
        this.chunks.push(chunk)
        this.onChunk?.(chunk)
      } else {
        this.stopped?.(e.data.sampleRate)
        this.stopped = null
      }
    }
  }

  close() {
    this.node?.port.postMessage('stop')
    this.source?.disconnect()
    this.node?.disconnect()
    this.sink?.disconnect()
    this.analysers.forEach((a) => a.disconnect())
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.source = null
    this.node = null
    this.sink = null
    this.analysers = []
  }

  /** Input level, for the input meter. */
  readMeter(): MeterReading | null {
    if (!this.analysers.length) return null
    const peak: [number, number] = [0, 0]
    const rms: [number, number] = [0, 0]
    this.analysers.forEach((a, i) => {
      a.getFloatTimeDomainData(this.meterData)
      let max = 0
      let sum = 0
      for (const v of this.meterData) {
        max = Math.max(max, Math.abs(v))
        sum += v * v
      }
      peak[i] = max
      rms[i] = Math.sqrt(sum / this.meterData.length)
    })
    return { peak, rms }
  }

  start() {
    if (!this.node) throw new RecordingUnavailableError('No audio input is open.')
    this.chunks = []
    this.node.port.postMessage('start')
  }

  /** Stops capturing and returns everything captured since start(). */
  stop(): Promise<{ chunks: RecordedChunk[]; sampleRate: number }> {
    const node = this.node
    if (!node) return Promise.resolve({ chunks: [], sampleRate: this.ctx.sampleRate })
    return new Promise((resolve) => {
      this.stopped = (sampleRate) => resolve({ chunks: this.chunks, sampleRate })
      node.port.postMessage('stop')
    })
  }
}
