// WAV (RIFF, integer PCM) encoding. Pure functions, so they run in a worker and in tests.

export type BitDepth = 16 | 24

export interface WavOptions {
  sampleRate: number
  bitDepth: BitDepth
  /** Add TPDF dither before rounding to 16 bits (ignored for 24-bit). Defaults to true. */
  dither?: boolean
  /** Random source for dither, replaceable in tests. */
  random?: () => number
}

const HEADER_BYTES = 44

/** Encodes channels of float samples (-1…1) as an interleaved PCM WAV file. */
export function encodeWav(channels: Float32Array[], options: WavOptions): ArrayBuffer {
  const { sampleRate, bitDepth, random = Math.random } = options
  const dither = options.dither ?? true
  const channelCount = channels.length
  const frames = channels[0]?.length ?? 0
  const bytesPerSample = bitDepth / 8
  const blockAlign = channelCount * bytesPerSample
  const dataBytes = frames * blockAlign
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)

  const max = bitDepth === 16 ? 0x7fff : 0x7fffff
  const useDither = dither && bitDepth === 16
  let offset = HEADER_BYTES
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      let v = channels[c][i] * max
      // Triangular dither of ±1 LSB decorrelates rounding error from the signal.
      if (useDither) v += random() - random()
      const s = Math.max(-max - 1, Math.min(max, Math.round(v)))
      if (bitDepth === 16) {
        view.setInt16(offset, s, true)
      } else {
        view.setUint8(offset, s & 0xff)
        view.setUint8(offset + 1, (s >> 8) & 0xff)
        view.setUint8(offset + 2, (s >> 16) & 0xff)
      }
      offset += bytesPerSample
    }
  }
  return buffer
}

/** Highest absolute sample value across channels. */
export function peakOf(channels: Float32Array[]): number {
  let peak = 0
  for (const data of channels) {
    for (const v of data) {
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
  }
  return peak
}
