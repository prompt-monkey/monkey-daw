// Writing automation by moving controls: with write mode on and the song playing, moving a
// fader, pan or knob records the movement into its lane at the playhead. While a control is
// held, what was already in the lane from where the movement started up to the playhead is
// replaced ("touch" writing). The whole movement is one undo step.

import { engine } from '../audio/engine'
import type { AutomationTarget, Id, Project } from '../model/types'
import { useProjectStore } from '../state/projectStore'
import { playheadPosition, useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { insertPoint } from './curve'
import { resolveTarget } from './targets'

type ChannelRef = Id | 'master'

/** Closer than this to the last written point, the point is updated instead of adding one. */
const MIN_SPACING = 0.02

/** The movement being written: its key and the last time it wrote. */
let active: { key: string; last: number } | null = null

const writeKey = (ref: ChannelRef, target: AutomationTarget) => `${ref}|${target}`

function holder(p: Project, ref: ChannelRef) {
  if (ref === 'master') return p.master
  return p.tracks.find((t) => t.id === ref) ?? p.buses.find((b) => b.id === ref)
}

/** True while write mode is on and the song is playing. */
export const isWriting = () => useViewStore.getState().automationWrite && useTransportStore.getState().playing

/**
 * Records a control's new value (in its real units) into its lane at the playhead, together with
 * the control's own change (`apply`), as one undoable step per movement. Returns false when not
 * writing, so the caller makes the plain change instead.
 */
export function writeAutomation(ref: ChannelRef, target: AutomationTarget, real: number, apply: (p: Project) => void): boolean {
  if (!isWriting()) return false
  const key = writeKey(ref, target)
  const now = playheadPosition()
  const from = active?.key === key ? active.last : now
  let written = false
  useProjectStore.getState().update(
    'Write automation',
    (p) => {
      apply(p)
      const channel = holder(p, ref)
      const resolved = channel && resolveTarget(channel, target)
      if (!channel || !resolved) return
      let lane = channel.automation.find((l) => l.target === target)
      if (!lane) {
        lane = { target, points: [] }
        channel.automation.push(lane)
      }
      const value = Math.min(1, Math.max(0, resolved.fromReal(real)))
      // Replace what was there since the movement's last point (a loop wrap starts afresh).
      if (now >= from) lane.points = lane.points.filter((pt) => pt.time <= from + 1e-6 || pt.time > now + 1e-6)
      const last = lane.points.find((pt) => Math.abs(pt.time - from) < 1e-6)
      if (last && active?.key === key && now - from < MIN_SPACING) last.value = value
      else lane.points = insertPoint(lane.points, { time: now, value, curve: 0 })
      written = true
    },
    `auto-write:${key}`,
  )
  if (!written) return false
  if (!(active?.key === key && now - from < MIN_SPACING)) active = { key, last: now }
  engine.setWriting(key, true)
  return true
}

function finish() {
  if (!active) return
  engine.setWriting(active.key, false)
  active = null
}

/** Ends a write when its movement ends (the gesture closes) or playback stops. Call once. */
export function connectAutomationWrite() {
  useProjectStore.subscribe((s, prev) => {
    if (prev.history.openKey?.startsWith('auto-write:') && s.history.openKey !== prev.history.openKey) finish()
  })
  useTransportStore.subscribe((s, prev) => {
    if (prev.playing && !s.playing) finish()
  })
}
