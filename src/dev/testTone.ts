// Development helper: a synthesized clip, so the engine can be exercised without audio files.

/** A bar of four decaying plucks, one per beat at the given tempo. */
export function createTestTone(ctx: BaseAudioContext, frequency: number, bpm: number): AudioBuffer {
  const beat = 60 / bpm
  const length = Math.ceil(beat * 4 * ctx.sampleRate)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let i = 0; i < length; i++) {
    const t = i / ctx.sampleRate
    const beatIndex = Math.floor(t / beat)
    const local = t - beatIndex * beat
    const f = beatIndex === 0 ? frequency * 2 : frequency
    const v = Math.sin(2 * Math.PI * f * local) * Math.exp(-local * 9) * 0.5
    left[i] = v
    right[i] = v
  }
  return buffer
}
