import { encodeWav, type BitDepth } from './wav'

interface Request {
  channels: Float32Array[]
  sampleRate: number
  bitDepth: BitDepth
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

scope.onmessage = (e) => {
  const { channels, sampleRate, bitDepth } = e.data
  const wav = encodeWav(channels, { sampleRate, bitDepth })
  scope.postMessage(wav, [wav])
}
