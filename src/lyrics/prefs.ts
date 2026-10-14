// How the lyrics panel is shown: remembered in this browser, not part of the project.

import { create } from 'zustand'

export type LyricsMode = 'write' | 'sing'

export const MIN_FONT = 12
export const MAX_FONT = 44
const KEY = 'monkey-daw:lyrics-view'

interface LyricsPrefs {
  mode: LyricsMode
  /** Text size in Sing mode, in pixels. */
  fontSize: number
}

function load(): LyricsPrefs {
  const defaults: LyricsPrefs = { mode: 'write', fontSize: 22 }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return {
      mode: raw?.mode === 'sing' ? 'sing' : 'write',
      fontSize: typeof raw?.fontSize === 'number' ? Math.min(MAX_FONT, Math.max(MIN_FONT, raw.fontSize)) : defaults.fontSize,
    }
  } catch {
    return defaults
  }
}

export const useLyricsPrefs = create<LyricsPrefs>()(load)

useLyricsPrefs.subscribe((prefs) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
})

export const setLyricsMode = (mode: LyricsMode) => useLyricsPrefs.setState({ mode })
export const changeFontSize = (delta: number) =>
  useLyricsPrefs.setState((s) => ({ fontSize: Math.min(MAX_FONT, Math.max(MIN_FONT, s.fontSize + delta)) }))
