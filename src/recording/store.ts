import { create } from 'zustand'
import type { Id } from '../model/types'
import type { ChannelMode } from './take'

/** Per-device recording preferences, kept in this browser. */
export interface RecordingPrefs {
  deviceId: string | null
  channelMode: ChannelMode
  /** Manual latency compensation in ms; null uses the latency the browser reports. */
  latencyMs: number | null
  countInBars: 0 | 1 | 2
  metronome: boolean
  metronomeVolume: number
}

export const DEFAULT_PREFS: RecordingPrefs = {
  deviceId: null,
  channelMode: 'mono',
  latencyMs: null,
  countInBars: 1,
  metronome: false,
  metronomeVolume: 0.6,
}

const PREFS_KEY = 'monkey-daw:recording:v1'

function loadPrefs(): RecordingPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')
    return raw && typeof raw === 'object' ? { ...DEFAULT_PREFS, ...raw } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

export type RecordingStatus = 'idle' | 'opening' | 'counting-in' | 'recording' | 'saving'

/** The take being recorded, for drawing it live on the timeline. */
export interface LiveTake {
  trackId: Id
  start: number
  /** Peak level per recorded chunk. */
  peaks: number[]
  /** Seconds of audio each peak covers. */
  peakDuration: number
}

interface RecordingStore {
  prefs: RecordingPrefs
  /** The armed track (one at a time); null when none is armed. */
  armedTrackId: Id | null
  inputOpen: boolean
  status: RecordingStatus
  devices: { id: string; label: string }[]
  live: LiveTake | null
  setPrefs: (patch: Partial<RecordingPrefs>) => void
}

export const useRecordingStore = create<RecordingStore>()((set) => ({
  prefs: loadPrefs(),
  armedTrackId: null,
  inputOpen: false,
  status: 'idle',
  devices: [],
  live: null,
  setPrefs: (patch) =>
    set((s) => {
      const prefs = { ...s.prefs, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      } catch {
        // Storage unavailable; the preference lasts for this session.
      }
      return { prefs }
    }),
}))
