// Transport state is not part of the project (and not undoable). The live playhead position is
// read from the engine every animation frame; this store only holds what the UI renders on change.

import { create } from 'zustand'
import { engine } from '../audio/engine'
import { useProjectStore } from './projectStore'
import { useViewStore } from './viewStore'

interface TransportStore {
  playing: boolean
  /** Where playback starts, and where the playhead rests while stopped. */
  cursor: number
}

export const useTransportStore = create<TransportStore>()(() => ({ playing: false, cursor: 0 }))

/** The clip to loop on its own: the piano roll's clip, while the piano roll is shown in PAT mode. */
export function activePattern(): string | null {
  return activePatternOf(useViewStore.getState())
}

export async function play() {
  const { cursor } = useTransportStore.getState()
  useTransportStore.setState({ playing: true })
  try {
    await engine.play(cursor, { pattern: activePattern() })
  } catch (err) {
    useTransportStore.setState({ playing: false })
    throw err
  }
}

/** Stops and returns the playhead to the start of the project. */
export function stop() {
  engine.stop()
  useTransportStore.setState({ playing: false, cursor: 0 })
}

/** Stops and leaves the playhead where it is. */
export function pause() {
  const position = engine.stop()
  useTransportStore.setState({ playing: false, cursor: position ?? useTransportStore.getState().cursor })
}

export function togglePlay() {
  if (useTransportStore.getState().playing) pause()
  else void play()
}

export function seek(seconds: number) {
  const cursor = Math.max(0, seconds)
  useTransportStore.setState({ cursor })
  if (engine.isPlaying) void engine.play(cursor, { pattern: activePattern() })
}

function activePatternOf(s: ReturnType<typeof useViewStore.getState>) {
  return s.pianoRoll && s.patternMode && s.bottomPanel === 'pianoRoll' && s.mixerOpen ? s.pianoRoll.clipId : null
}

/** Playhead position for display: live while playing, the cursor otherwise. */
export function playheadPosition(): number {
  return engine.position() ?? useTransportStore.getState().cursor
}

/** Keeps the engine in sync with the project and the resting playhead. Call once at startup. */
export function connectEngine() {
  engine.setProject(useProjectStore.getState().project)
  // Switching between PAT and SONG (or to another clip) while playing continues in the new mode.
  useViewStore.subscribe((s, prev) => {
    if (!engine.isPlaying) return
    const now = activePatternOf(s)
    if (activePatternOf(prev) !== now) void engine.play(engine.position() ?? useTransportStore.getState().cursor, { pattern: now })
  })
  useTransportStore.subscribe((s, prev) => s.cursor !== prev.cursor && engine.setRestingPosition(s.cursor))
  return useProjectStore.subscribe((s, prev) => {
    if (s.project !== prev.project) engine.setProject(s.project)
  })
}
