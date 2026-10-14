const HUES = [185, 265, 35, 140, 320, 220, 85, 0]

/** Colour for a track's clips and header accent, by track position. */
export function trackColor(index: number): string {
  return `oklch(72% 0.13 ${HUES[index % HUES.length]})`
}
