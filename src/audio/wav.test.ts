import { describe, expect, it } from 'vitest'
import { encodeWav, peakOf } from './wav'

const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

const int24 = (view: DataView, offset: number) => {
  const v = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
  return v & 0x800000 ? v - 0x1000000 : v
}

describe('encodeWav', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1, -1, 2])
  const right = new Float32Array([0.25, -0.25, 0, 0, 0, -3])

  it('writes a valid 16-bit stereo header', () => {
    const view = new DataView(encodeWav([left, right], { sampleRate: 44100, bitDepth: 16, dither: false }))
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(28, true)).toBe(44100 * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(6 * 4)
    expect(view.getUint32(4, true)).toBe(36 + 6 * 4)
    expect(view.byteLength).toBe(44 + 6 * 4)
  })

  it('interleaves 16-bit samples and clips out-of-range values', () => {
    const view = new DataView(encodeWav([left, right], { sampleRate: 44100, bitDepth: 16, dither: false }))
    const sample = (frame: number, channel: number) => view.getInt16(44 + (frame * 2 + channel) * 2, true)
    expect(sample(0, 0)).toBe(0)
    expect(sample(0, 1)).toBe(8192)
    expect(sample(1, 0)).toBe(16384)
    expect(sample(2, 0)).toBe(-16383) // -16383.5 rounds up
    expect(sample(3, 0)).toBe(32767)
    expect(sample(4, 0)).toBe(-32767)
    expect(sample(5, 0)).toBe(32767)
    expect(sample(5, 1)).toBe(-32768)
  })

  it('writes 24-bit samples', () => {
    const view = new DataView(encodeWav([left, right], { sampleRate: 48000, bitDepth: 24 }))
    expect(view.getUint16(34, true)).toBe(24)
    expect(view.getUint16(32, true)).toBe(6)
    expect(view.getUint32(40, true)).toBe(6 * 6)
    const sample = (frame: number, channel: number) => int24(view, 44 + (frame * 2 + channel) * 3)
    expect(sample(1, 0)).toBe(Math.round(0.5 * 0x7fffff))
    expect(sample(2, 0)).toBe(Math.round(-0.5 * 0x7fffff))
    expect(sample(5, 1)).toBe(-0x800000)
  })

  it('adds at most one step of dither at 16 bits', () => {
    const silence = new Float32Array(1000)
    const view = new DataView(encodeWav([silence], { sampleRate: 44100, bitDepth: 16, random: () => Math.random() }))
    const values = Array.from({ length: 1000 }, (_, i) => view.getInt16(44 + i * 2, true))
    expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(values.some((v) => v !== 0)).toBe(true)
  })
})

describe('peakOf', () => {
  it('finds the largest absolute sample', () => {
    expect(peakOf([new Float32Array([0.1, -0.7]), new Float32Array([0.5])])).toBeCloseTo(0.7)
    expect(peakOf([new Float32Array(0)])).toBe(0)
  })
})
