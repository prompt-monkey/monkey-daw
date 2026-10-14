// Time stretching that keeps the pitch: WSOLA (waveform-similarity overlap-add). The audio is cut
// into overlapping windowed frames that are laid out at a new spacing; each frame is taken from
// near its nominal position where it best continues the previous one, which avoids the phasing
// of plain overlap-add. Good on loops and drums; heavy stretches of sustained tones can warble.

/** Frame length and search range, in seconds. */
const FRAME = 0.04
const SEARCH = 0.012
/** The coarse search looks at every 4th candidate and sample, then refines around the best. */
const COARSE = 4

/**
 * Stretches audio so it plays `rate` times faster (rate 2: half as long) at the same pitch.
 * All channels use the same frame positions, so the stereo image stays intact.
 */
export function timeStretch(channels: Float32Array[], sampleRate: number, rate: number): Float32Array[] {
  const input = channels[0]?.length ?? 0
  const outLength = Math.max(1, Math.round(input / rate))
  if (!input || Math.abs(rate - 1) < 1e-4) return channels.map((c) => c.slice(0, outLength))

  const n = Math.max(64, Math.round((FRAME * sampleRate) / 2) * 2)
  const hop = n / 2
  const delta = Math.round(SEARCH * sampleRate)
  const window = new Float32Array(n)
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)

  // Frames are matched on a mono mix.
  const mono = new Float32Array(input)
  for (const c of channels) for (let i = 0; i < input; i++) mono[i] += c[i] / channels.length

  /** Similarity of the `hop` samples at a and b (normalized by b's energy), every `step` samples. */
  const similarity = (a: number, b: number, step: number) => {
    let dot = 0
    let energy = 1e-9
    for (let i = 0; i < hop; i += step) {
      const y = mono[b + i]
      dot += mono[a + i] * y
      energy += y * y
    }
    return dot / Math.sqrt(energy)
  }

  const out = channels.map(() => new Float32Array(outLength + n))
  const lastStart = Math.max(0, input - n)
  let previous = 0
  for (let k = 0; k * hop < outLength; k++) {
    const nominal = Math.min(lastStart, Math.round(k * hop * rate))
    let pos = nominal
    const target = previous + hop
    if (k > 0 && target + hop <= input) {
      const lo = Math.max(0, nominal - delta)
      const hi = Math.min(lastStart, nominal + delta)
      let best = -Infinity
      for (let p = lo; p <= hi; p += COARSE) {
        const s = similarity(target, p, COARSE)
        if (s > best) {
          best = s
          pos = p
        }
      }
      const coarse = pos
      for (let p = Math.max(lo, coarse - COARSE + 1); p <= Math.min(hi, coarse + COARSE - 1); p++) {
        const s = similarity(target, p, 1)
        if (s > best) {
          best = s
          pos = p
        }
      }
    }
    const at = k * hop
    channels.forEach((c, ch) => {
      const o = out[ch]
      for (let i = 0; i < n && pos + i < input; i++) {
        // The first frame starts at full level instead of fading in.
        const w = k === 0 && i < hop ? 1 : window[i]
        o[at + i] += c[pos + i] * w
      }
    })
    previous = pos
  }
  return out.map((o) => o.slice(0, outLength))
}
