// Tempo sync: an audio clip with an original tempo (usually read from its file name) plays at
// project BPM ÷ original BPM, so loops fit the project's tempo.

import { isMidiClip, type Clip } from './types'

export const MIN_SOURCE_BPM = 40
export const MAX_SOURCE_BPM = 300

/** "Loop 95bpm", "loop_bpm95", "loop 128 BPM": the tempo is spelled out. */
const EXPLICIT = [/(\d{2,3}(?:[.,]\d+)?)\s*[-_ ]?bpm/i, /bpm\s*[-_ ]?(\d{2,3}(?:[.,]\d+)?)/i]
/** A bare number between separators: "Guitar_92_Am", "Keys - 120 - C". */
const BARE = /(?:^|[\s_\-()[\]])(\d{2,3})(?=$|[\s_\-()[\].])/g

/** True when `seconds` is close to a whole number of beats (two or more) at `bpm`. */
function fitsBeats(seconds: number, bpm: number): boolean {
  const beats = (seconds * bpm) / 60
  return beats >= 1.9 && Math.abs(beats - Math.round(beats)) < 0.03 * Math.max(1, beats / 8)
}

/**
 * The tempo a sample was made at, read from its name. A number labelled "bpm" is trusted; a bare
 * number (60–200) only counts when the sample lasts a whole number of beats at that tempo.
 */
export function detectBpm(name: string, duration?: number): number | null {
  for (const pattern of EXPLICIT) {
    const match = name.match(pattern)
    if (!match) continue
    const bpm = Number(match[1].replace(',', '.'))
    if (bpm >= MIN_SOURCE_BPM && bpm <= MAX_SOURCE_BPM) return bpm
  }
  if (duration === undefined) return null
  for (const match of name.matchAll(BARE)) {
    const bpm = Number(match[1])
    if (bpm >= 60 && bpm <= 200 && fitsBeats(duration, bpm)) return bpm
  }
  return null
}

/** Seconds of the clip's audio played per second of timeline (1 when the clip isn't synced). */
export function clipRate(clip: Clip, bpm: number): number {
  if (isMidiClip(clip) || !clip.sourceBpm) return 1
  return bpm / clip.sourceBpm
}
