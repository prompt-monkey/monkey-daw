import { useEffect, useRef } from 'react'
import { playheadPosition } from '../state/transport'

type FrameCallback = (seconds: number) => void

const callbacks = new Set<FrameCallback>()
let frame = 0

function loop() {
  // Reschedule first, and isolate each callback: one failing display must not stop the loop,
  // or every playhead-driven display (time, playhead line, meters, knobs) would freeze for good.
  frame = callbacks.size ? requestAnimationFrame(loop) : 0
  const t = playheadPosition()
  for (const cb of callbacks) {
    try {
      cb(t)
    } catch (err) {
      console.error('Playhead frame callback failed', err)
    }
  }
}

/** Calls `cb` with the playhead position on every animation frame until unsubscribed. */
export function subscribePlayheadFrame(cb: FrameCallback): () => void {
  callbacks.add(cb)
  if (!frame) frame = requestAnimationFrame(loop)
  return () => {
    callbacks.delete(cb)
  }
}

/**
 * Calls `cb` with the playhead position on every animation frame. All subscribers share one
 * loop, and updates happen outside React so playback never re-renders the tree.
 */
export function usePlayheadFrame(cb: FrameCallback) {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => subscribePlayheadFrame((t) => ref.current(t)), [])
}
