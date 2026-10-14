// Transport state is not part of the project (and not undoable). The live playhead position is
// read from the engine every animation frame; this store only holds what the UI renders on change.

import { create } from 'zustand'
import { engine } from '../audio/engine'
import { useProjectStore } from './projectStore'

interface TransportStore {
  playing: boolean
  /** Where playback starts, and where the playhead rests while stopped. */
  cursor: number
}

export const useTransportStore = create<TransportStore>()(() => ({ playing: false, cursor: 0 }))

export async function play() {
  const { cursor } = useTransportStore.getState()
  useTransportStore.setState({ playing: true })
  try {
    await engine.play(cursor)
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
  if (engine.isPlaying) void engine.play(cursor)
}

/** Playhead position for display: live while playing, the cursor otherwise. */
export function playheadPosition(): number {
  return engine.position() ?? useTransportStore.getState().cursor
}

/** Keeps the engine in sync with the project. Call once at startup. */
export function connectEngine() {
  engine.setProject(useProjectStore.getState().project)
  return useProjectStore.subscribe((s, prev) => {
    if (s.project !== prev.project) engine.setProject(s.project)
  })
}
