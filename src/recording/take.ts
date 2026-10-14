// Turns recorded input chunks into the audio of a take. Pure, so it is unit-tested.

/** Which input channels a take keeps. Anything but 'stereo' gives a mono take. */
export type ChannelMode = 'stereo' | 'left' | 'right' | 'mono'

export interface RecordedChunk {
  /** Audio clock time of the chunk's first sample. */
  time: number
  /** One array per input channel (1 for a mono device, 2 for stereo). */
  channels: Float32Array[]
}

/**
 * Builds the take's channels so its first sample is the one captured at `startTime` (audio clock).
 * Earlier samples (count-in, latency) are dropped; if capture began after `startTime`, the take
 * starts with silence so it still lines up.
 */
export function buildTake(chunks: RecordedChunk[], sampleRate: number, startTime: number, mode: ChannelMode): Float32Array[] {
  if (!chunks.length) return []
  const inputChannels = Math.max(...chunks.map((c) => c.channels.length))
  const total = chunks.reduce((n, c) => n + c.channels[0].length, 0)
  const skip = Math.round((startTime - chunks[0].time) * sampleRate)
  const length = Math.max(0, total - skip)

  // Join chunks per input channel, dropping `skip` samples or padding -skip samples of silence.
  const joined = Array.from({ length: inputChannels }, () => new Float32Array(length))
  let source = 0
  for (const chunk of chunks) {
    const n = chunk.channels[0].length
    for (let c = 0; c < inputChannels; c++) {
      const data = chunk.channels[Math.min(c, chunk.channels.length - 1)]
      const from = Math.max(0, skip - source)
      if (from >= n) continue
      joined[c].set(data.subarray(from), source + from - skip)
    }
    source += n
  }

  const left = joined[0]
  const right = joined[1] ?? joined[0]
  switch (mode) {
    case 'stereo':
      return [left, right]
    case 'left':
      return [left]
    case 'right':
      return [right]
    case 'mono': {
      const mono = new Float32Array(length)
      for (let i = 0; i < length; i++) mono[i] = (left[i] + right[i]) / 2
      return [mono]
    }
  }
}
