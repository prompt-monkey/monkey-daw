// Level math for faders and meters. Volumes are stored as linear gain (1 = 0 dB).

/** Highest fader gain: +6 dB. */
export const MAX_GAIN = 2
/** Bottom of the meter scale, in dB. */
export const METER_FLOOR_DB = -60
/** Top of the meter scale, in dB. */
export const METER_CEIL_DB = 6

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain)
}

export function dbToGain(db: number): number {
  return db === -Infinity ? 0 : 10 ** (db / 20)
}

/**
 * Fader travel (0–1) to gain, on a cubic curve: 0 dB sits at about 79% of the travel and
 * the top is +6 dB, so the useful range gets most of the fader.
 */
export function faderToGain(position: number): number {
  return MAX_GAIN * clamp(position, 0, 1) ** 3
}

export function gainToFader(gain: number): number {
  return Math.cbrt(clamp(gain, 0, MAX_GAIN) / MAX_GAIN)
}

/** e.g. "+1.5", "-12.0", "-∞" (dB, without unit). */
export function formatDb(gain: number): string {
  const db = gainToDb(gain)
  if (db < -99) return '-∞'
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`
}

/** Meter position (0–1) of a linear amplitude on the METER_FLOOR_DB…METER_CEIL_DB scale. */
export function meterPosition(amplitude: number): number {
  const db = gainToDb(amplitude)
  if (db === -Infinity) return 0
  return clamp((db - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB), 0, 1)
}
