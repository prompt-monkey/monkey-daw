import { describe, expect, it } from 'vitest'
import { encodeWav } from '../audio/wav'
import { wavDuration, wavDurationFromHeader } from './duration'

describe('wavDurationFromHeader', () => {
  it('reads the duration of a PCM WAV', () => {
    const half = new Float32Array(22050)
    expect(wavDurationFromHeader(encodeWav([half, half], { sampleRate: 44100, bitDepth: 16 }))).toBe(0.5)
    expect(wavDurationFromHeader(encodeWav([half], { sampleRate: 48000, bitDepth: 24 }))).toBeCloseTo(0.459375)
  })

  it('skips chunks before the data chunk', () => {
    const wav = new Uint8Array(encodeWav([new Float32Array(4410)], { sampleRate: 44100, bitDepth: 16 }))
    // Insert a 6-byte "LIST" chunk between "fmt " and "data".
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 6, 0, 0, 0, 1, 2, 3, 4, 5, 6])
    const withList = new Uint8Array(wav.length + list.length)
    withList.set(wav.subarray(0, 36))
    withList.set(list, 36)
    withList.set(wav.subarray(36), 36 + list.length)
    expect(wavDurationFromHeader(withList.buffer)).toBeCloseTo(0.1)
  })

  it('returns null for anything that is not a WAV', async () => {
    expect(wavDurationFromHeader(new TextEncoder().encode('ID3 mp3 data here...').buffer)).toBeNull()
    expect(await wavDuration(new Blob(['tiny']))).toBeNull()
  })
})
