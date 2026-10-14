import { useEffect, useRef } from 'react'
import { playheadPosition } from '../state/transport'

type FrameCallback = (seconds: number) => void

const callbacks = new Set<FrameCallback>()
let frame = 0

function loop() {
  const t = playheadPosition()
  for (const cb of callbacks) cb(t)
  frame = callbacks.size ? requestAnimationFrame(loop) : 0
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
  useEffect(() => {
    const wrapped: FrameCallback = (t) => ref.current(t)
    callbacks.add(wrapped)
    if (!frame) frame = requestAnimationFrame(loop)
    return () => {
      callbacks.delete(wrapped)
    }
  }, [])
}
