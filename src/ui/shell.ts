// App-wide display state: narrow (phone) layout, lite performance mode and fullscreen.
//
// Lite mode trades visual detail for smooth audio on slow devices: meters redraw less often,
// waveforms are drawn at lower resolution and the engine schedules further ahead. In Auto it
// turns on for devices that look weak, or when playback keeps dropping frames.

import { create } from 'zustand'
import { engine } from '../audio/engine'
import { useTransportStore } from '../state/transport'
import { HEADER_WIDTHS } from '../timeline/geometry'
import { subscribePlayheadFrame } from '../timeline/usePlayheadFrame'
import { toast } from './toast'

export type LitePreference = 'auto' | 'on' | 'off'

/** Below this width the layout switches to the narrow (phone) arrangement. */
const NARROW_QUERY = '(max-width: 767px)'
const LITE_KEY = 'monkey-daw:lite'
/** Seconds the engine schedules ahead: more survives longer main-thread stalls. */
const LOOKAHEAD = { normal: 0.12, lite: 0.3 }

interface ShellStore {
  narrow: boolean
  litePreference: LitePreference
  /** What Auto decided. */
  autoLite: boolean
  fullscreen: boolean
}

const readPreference = (): LitePreference => {
  try {
    const v = localStorage.getItem(LITE_KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** A device with few cores or little memory starts in lite mode. */
function looksWeak(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2
}

export const useShellStore = create<ShellStore>()(() => ({
  narrow: typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches,
  litePreference: typeof localStorage === 'undefined' ? 'auto' : readPreference(),
  autoLite: typeof navigator !== 'undefined' && looksWeak(),
  fullscreen: false,
}))

export function liteActive(s: Pick<ShellStore, 'litePreference' | 'autoLite'> = useShellStore.getState()): boolean {
  return s.litePreference === 'on' || (s.litePreference === 'auto' && s.autoLite)
}

export const useLite = () => useShellStore((s) => liteActive(s))

/** Width of the timeline's track header column. */
export const useHeaderWidth = () => useShellStore((s) => (s.narrow ? HEADER_WIDTHS.narrow : HEADER_WIDTHS.wide))

export function setLitePreference(litePreference: LitePreference) {
  useShellStore.setState({ litePreference })
  try {
    localStorage.setItem(LITE_KEY, litePreference)
  } catch {
    // Not remembered; fine for this session.
  }
}

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    toast('This browser did not allow fullscreen.', 'error')
  }
}

/** Frames slower than this count as dropped. */
const SLOW_FRAME_MS = 50
/** Out of the last FRAME_WINDOW frames during playback, this many slow ones switch Auto to lite. */
const FRAME_WINDOW = 120
const SLOW_LIMIT = 24

/**
 * Watches frame times during playback: if many frames are slow, Auto turns lite mode on. A
 * frame is only counted while the page is visible and playing.
 */
export class FrameMonitor {
  private times: number[] = []
  private last = 0

  /** Returns true when playback looks too slow. */
  frame(now: number, active: boolean): boolean {
    if (!active) {
      this.last = 0
      return false
    }
    if (this.last) {
      this.times.push(now - this.last)
      if (this.times.length > FRAME_WINDOW) this.times.shift()
    }
    this.last = now
    return this.times.length >= FRAME_WINDOW / 2 && this.times.filter((t) => t > SLOW_FRAME_MS).length >= SLOW_LIMIT
  }
}

/** Wires the shell state to the browser. Call once at startup. */
export function startShell() {
  const media = matchMedia(NARROW_QUERY)
  media.addEventListener('change', (e) => useShellStore.setState({ narrow: e.matches }))
  document.addEventListener('fullscreenchange', () => useShellStore.setState({ fullscreen: Boolean(document.fullscreenElement) }))

  const applyLookahead = () => engine.setLookahead(liteActive() ? LOOKAHEAD.lite : LOOKAHEAD.normal)
  applyLookahead()
  useShellStore.subscribe(applyLookahead)

  const monitor = new FrameMonitor()
  subscribePlayheadFrame(() => {
    const s = useShellStore.getState()
    if (s.autoLite || s.litePreference !== 'auto') return
    const active = useTransportStore.getState().playing && document.visibilityState === 'visible'
    if (monitor.frame(performance.now(), active)) {
      useShellStore.setState({ autoLite: true })
      toast('Lite mode is on to keep playback smooth. Change it in the View menu.')
    }
  })
}
