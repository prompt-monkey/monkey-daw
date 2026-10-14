// MP3 encoding with LAME (the lamejs port, LGPL; loaded only in the export worker).

import { Mp3Encoder } from '@breezystack/lamejs'

export type Mp3Bitrate = 128 | 192 | 256 | 320

/** Samples per channel handed to the encoder at a time (a multiple of the 1152-sample frame). */
const BLOCK = 1152 * 10

function toInt16(data: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from)
  for (let i = from; i < to; i++) {
    const v = Math.max(-1, Math.min(1, data[i]))
    out[i - from] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

/** Encodes one or two channels as a constant-bitrate MP3 file. */
export function encodeMp3(channels: Float32Array[], sampleRate: number, kbps: Mp3Bitrate): Uint8Array {
  const stereo = channels.length > 1
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps)
  const length = channels[0]?.length ?? 0
  const parts: Uint8Array[] = []
  for (let i = 0; i < length; i += BLOCK) {
    const end = Math.min(length, i + BLOCK)
    const left = toInt16(channels[0], i, end)
    const chunk = stereo ? encoder.encodeBuffer(left, toInt16(channels[1], i, end)) : encoder.encodeBuffer(left)
    if (chunk.length) parts.push(chunk.slice())
  }
  const last = encoder.flush()
  if (last.length) parts.push(last.slice())
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
