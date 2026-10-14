// Metronome clicks, scheduled by the playback engine on the audio clock. Clicks go straight to
// the speakers: they are never part of the mix or an export.

import { secondsPerBeat } from '../model/grid'
import type { TimeSignature } from '../model/types'

export interface Beat {
  /** Timeline time of the beat (negative during a count-in before 0). */
  time: number
  /** First beat of a bar. */
  accent: boolean
}

/** Beats in [from, to), on the project's grid. Works for negative times (count-ins). */
export function beatsInWindow(from: number, to: number, bpm: number, ts: TimeSignature): Beat[] {
  const beat = secondsPerBeat(bpm, ts)
  const beats: Beat[] = []
  // Small tolerance so a beat exactly on `from` isn't lost to floating-point error.
  // `|| 0` turns the -0 that Math.ceil gives for tiny negatives into 0.
  for (let i = Math.ceil(from / beat - 1e-9) || 0; i * beat < to - 1e-9; i++) {
    const index = ((i % ts.beats) + ts.beats) % ts.beats
    beats.push({ time: i * beat, accent: index === 0 })
  }
  return beats
}

/** Schedules one click: a short pitched blip, higher on the first beat of the bar. */
export function scheduleClick(ctx: BaseAudioContext, when: number, accent: boolean, volume: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = accent ? 1760 : 1175
  gain.gain.setValueAtTime(0, when)
  gain.gain.linearRampToValueAtTime(volume, when + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start(when)
  osc.stop(when + 0.06)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
}
