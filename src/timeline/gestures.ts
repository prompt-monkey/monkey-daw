// Pointer gestures on the timeline. Each gesture previews its edits in the view store and
// commits them as one undoable action on release. Listeners live on the window, so a drag keeps
// working when the clip re-renders in another lane. Escape cancels a gesture.

import { snapTime } from '../model/grid'
import type { Clip, Project } from '../model/types'
import { applyClipEdits } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { seek } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import type { ClipHandle } from './ClipView'
import {
  MAX_CLIP_GAIN,
  clipsInRect,
  moveClips,
  setFadeIn,
  setFadeOut,
  setGain,
  trimEnd,
  trimStart,
  type ClipPlacement,
  type ClipPreview,
} from './edits'
import { HEADER_WIDTH } from './geometry'

const DRAG_THRESHOLD = 3

export interface GestureContext {
  pps: number
  rowHeight: number
  /** Element wrapping all track rows; its left edge is the content's left edge. */
  lanes: HTMLElement
}

function timeAt(ctx: GestureContext, clientX: number): number {
  return (clientX - ctx.lanes.getBoundingClientRect().left - HEADER_WIDTH) / ctx.pps
}

function trackIndexAt(ctx: GestureContext, clientY: number): number {
  return Math.floor((clientY - ctx.lanes.getBoundingClientRect().top) / ctx.rowHeight)
}

function snapper(project: Project, free: boolean) {
  return (t: number) => (free ? Math.max(0, t) : snapTime(t, project.snap, project.bpm, project.timeSignature))
}

function placements(project: Project, ids: string[]): ClipPlacement[] {
  const out: ClipPlacement[] = []
  project.tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) if (ids.includes(clip.id)) out.push({ clip, trackIndex })
  })
  return out
}

/** Runs move/up/escape handlers for one drag; returns nothing, cleans up after itself. */
function track(
  e: React.PointerEvent,
  onMove: (ev: PointerEvent, moved: boolean) => void,
  onEnd: (ev: PointerEvent | null, moved: boolean) => void,
  cursor: string,
) {
  const x0 = e.clientX
  const y0 = e.clientY
  let moved = false
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - x0) < DRAG_THRESHOLD && Math.abs(ev.clientY - y0) < DRAG_THRESHOLD) return
    if (!moved) document.body.style.cursor = cursor
    moved = true
    onMove(ev, true)
  }
  const finish = (ev: PointerEvent | null) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    document.body.style.cursor = ''
    onEnd(ev, moved)
  }
  const up = (ev: PointerEvent) => finish(ev)
  const cancel = () => finish(null)
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.stopPropagation()
    finish(null)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
}

const LABELS: Record<ClipHandle, string> = {
  body: 'Move clip',
  'trim-start': 'Trim clip',
  'trim-end': 'Trim clip',
  'fade-in': 'Fade in',
  'fade-out': 'Fade out',
  gain: 'Clip gain',
}

export function startClipGesture(e: React.PointerEvent, clip: Clip, handle: ClipHandle, ctx: GestureContext) {
  e.stopPropagation()
  const view = useViewStore.getState()
  if (handle === 'body' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
    view.toggleSelected(clip.id)
    return
  }
  if (!view.selection.includes(clip.id)) view.setSelection([clip.id])

  const project = useProjectStore.getState().project
  const trackIds = project.tracks.map((t) => t.id)
  const group = placements(project, handle === 'body' ? useViewStore.getState().selection : [clip.id])
  const own = group.find((g) => g.clip.id === clip.id)
  if (!own) return
  const assetDuration = project.assets[clip.assetId]?.duration ?? clip.offset + clip.duration
  const startTrack = trackIndexAt(ctx, e.clientY)
  const x0 = e.clientX
  const y0 = e.clientY

  track(
    e,
    (ev) => {
      const dt = (ev.clientX - x0) / ctx.pps
      const snap = snapper(project, ev.altKey)
      let preview: ClipPreview
      const only = (fields: Partial<Clip>): ClipPreview => ({ [clip.id]: { trackId: trackIds[own.trackIndex], fields } })
      switch (handle) {
        case 'body':
          preview = moveClips(group, clip, dt, trackIndexAt(ctx, ev.clientY) - startTrack, trackIds, snap)
          break
        case 'trim-start':
          preview = only(trimStart(clip, snap(clip.start + dt)))
          break
        case 'trim-end':
          preview = only(trimEnd(clip, assetDuration, snap(clip.start + clip.duration + dt)))
          break
        case 'fade-in':
          preview = only(setFadeIn(clip, clip.fadeIn + dt))
          break
        case 'fade-out':
          preview = only(setFadeOut(clip, clip.fadeOut - dt))
          break
        case 'gain':
          preview = only(setGain(clip.gain - ((ev.clientY - y0) * MAX_CLIP_GAIN) / Math.max(20, ctx.rowHeight - 20)))
          break
      }
      useViewStore.getState().setPreview(preview)
    },
    (ev, moved) => {
      const preview = useViewStore.getState().preview
      useViewStore.getState().setPreview(null)
      if (!ev || !moved || !preview) return
      const edits = Object.entries(preview).map(([clipId, entry]) => ({ clipId, trackId: entry.trackId, fields: entry.fields }))
      const label = handle === 'body' && edits.length > 1 ? 'Move clips' : LABELS[handle]
      applyClipEdits(label, edits)
    },
    handle === 'body' ? 'grabbing' : handle === 'gain' ? 'ns-resize' : 'ew-resize',
  )
}

/** Drag on empty lane space: rubber-band selection. A plain click deselects and moves the cursor. */
export function startLaneGesture(e: React.PointerEvent, ctx: GestureContext) {
  if (e.button !== 0) return
  const additive = e.shiftKey || e.ctrlKey || e.metaKey
  const initial = additive ? useViewStore.getState().selection : []
  const t0 = timeAt(ctx, e.clientX)
  const track0 = trackIndexAt(ctx, e.clientY)

  track(
    e,
    (ev) => {
      const t1 = timeAt(ctx, ev.clientX)
      const track1 = trackIndexAt(ctx, ev.clientY)
      const view = useViewStore.getState()
      view.setMarquee({ t0, t1, track0, track1 })
      const hits = clipsInRect(useProjectStore.getState().project.tracks, t0, t1, track0, track1)
      view.setSelection([...new Set([...initial, ...hits])])
    },
    (ev, moved) => {
      useViewStore.getState().setMarquee(null)
      if (!ev || moved) return
      if (!additive) useViewStore.getState().setSelection([])
      seek(snapper(useProjectStore.getState().project, ev.altKey)(t0))
    },
    'crosshair',
  )
}
