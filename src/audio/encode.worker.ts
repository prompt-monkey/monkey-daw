// Encodes rendered audio off the main thread: WAV, or MP3 (the encoder is only loaded here).

import type { Mp3Bitrate } from './mp3'
import { encodeWav, type BitDepth } from './wav'

export type EncodeRequest =
  | { format: 'wav'; channels: Float32Array[]; sampleRate: number; bitDepth: BitDepth }
  | { format: 'mp3'; channels: Float32Array[]; sampleRate: number; bitrate: Mp3Bitrate }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

scope.onmessage = async (e) => {
  const req = e.data
  if (req.format === 'wav') {
    const wav = encodeWav(req.channels, { sampleRate: req.sampleRate, bitDepth: req.bitDepth })
    scope.postMessage(wav, [wav])
    return
  }
  const { encodeMp3 } = await import('./mp3')
  const mp3 = encodeMp3(req.channels, req.sampleRate, req.bitrate)
  scope.postMessage(mp3.buffer, [mp3.buffer])
}
