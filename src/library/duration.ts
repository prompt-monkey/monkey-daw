// Reads a WAV file's duration from its header, without decoding the audio.

/** Bytes read from the start of the file; header chunks normally sit well within this. */
const HEADER_BYTES = 64 * 1024

/** Duration in seconds of a PCM/float WAV file, or null if the header can't be read. */
export function wavDurationFromHeader(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes)
  const tag = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)))
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let byteRate = 0
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ' && offset + 20 <= bytes.byteLength) byteRate = view.getUint32(offset + 16, true)
    if (id === 'data') return byteRate > 0 ? size / byteRate : null
    offset += 8 + size + (size % 2) // chunks are padded to even sizes
  }
  return null
}

export async function wavDuration(file: Blob): Promise<number | null> {
  try {
    return wavDurationFromHeader(await file.slice(0, HEADER_BYTES).arrayBuffer())
  } catch {
    return null
  }
}
