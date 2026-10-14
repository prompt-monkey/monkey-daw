import { useState } from 'react'
import type { AutomationTarget, Track } from '../model/types'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { valueAt } from './curve'

/** Re-render only when the value moves more than this (0–1 scale), to keep playback cheap. */
const STEP = 0.002

/**
 * The automation value (0–1) of a target at the playhead, following playback. Null when the
 * target has no automation points, so the control shows its own value.
 */
export function useAutomatedValue(track: Track | undefined, target: AutomationTarget): number | null {
  const points = track?.automation.find((l) => l.target === target)?.points
  const [value, setValue] = useState<number | null>(null)

  usePlayheadFrame((t) => {
    const next = points?.length ? valueAt(points, t) : null
    setValue((prev) => (next === null || prev === null || Math.abs(next - prev) > STEP ? next : prev))
  })

  return points?.length ? value : null
}
