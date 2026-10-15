// Pointer gestures on the timeline. Each gesture previews its edits in the view store and
// commits them as one undoable action on release. Listeners live on the window, so a drag keeps
// working when the clip re-renders in another lane. Escape cancels a gesture.

import { secondsPerBeat, snapStep, snapTime } from '../model/grid'
import { clipRate } from '../model/tempo'
import { isMidiClip, type Clip, type Project } from '../model/types'
import { applyClipEdits, moveTrack, splitClips } from '../state/actions'
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
  stretchEnd,
  trimEnd,
  trimStart,
  type ClipPlacement,
  type ClipPreview,
} from './edits'

const DRAG_THRESHOLD = 3

export interface GestureContext {
  pps: number
  rowHeight: number
  /** Element wrapping all track rows; its left edge is the content's left edge. */
  lanes: HTMLElement
  /** Width of the track header column, left of the lanes. */
  headerWidth: number
}

function timeAt(ctx: GestureContext, clientX: number): number {
  return (clientX - ctx.lanes.getBoundingClientRect().left - ctx.headerWidth) / ctx.pps
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

/** Pixels of vertical drag for a full bend of a fade curve. */
const CURVE_DRAG = 60

/** A fade's new curve after dragging `dy` pixels (up bends it toward a fast fade). */
function fadeCurve(key: 'fadeInCurve' | 'fadeOutCurve', curve = 0, dy: number): Partial<Clip> {
  return { [key]: Math.max(-1, Math.min(1, Math.round((curve - dy / CURVE_DRAG) * 20) / 20)) }
}

const LABELS: Record<ClipHandle, string> = {
  body: 'Move clip',
  'trim-start': 'Trim clip',
  'trim-end': 'Trim clip',
  'fade-in': 'Fade in',
  'fade-out': 'Fade out',
  gain: 'Clip gain',
}

/** Where an Alt+click on a clip cuts it: the pointer's time, on the grid unless the magnet is off. */
export function razorTime(ctx: GestureContext, clientX: number): number {
  return snapper(useProjectStore.getState().project, false)(timeAt(ctx, clientX))
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
  const trackKinds = project.tracks.map((t) => t.kind)
  const group = placements(project, handle === 'body' ? useViewStore.getState().selection : [clip.id])
  const own = group.find((g) => g.clip.id === clip.id)
  if (!own) return
  // MIDI clips can be extended freely; audio clips end where their audio ends.
  const trim = {
    rate: clipRate(clip, project.bpm),
    reversed: !isMidiClip(clip) && clip.reversed === true,
    assetDuration: isMidiClip(clip) ? Infinity : (project.assets[clip.assetId]?.duration ?? clip.offset + clip.duration),
  }
  const startTrack = trackIndexAt(ctx, e.clientY)
  const x0 = e.clientX
  const y0 = e.clientY
  // Alt+click on a clip is the razor; Alt+drag still moves it off the grid.
  const razor = handle === 'body' && e.altKey
  // Shift+drag on the right edge of an audio clip stretches its audio to the new length.
  const stretch = handle === 'trim-end' && e.shiftKey && !isMidiClip(clip)

  track(
    e,
    (ev) => {
      const dt = (ev.clientX - x0) / ctx.pps
      const snap = snapper(project, ev.altKey)
      let preview: ClipPreview
      const only = (fields: Partial<Clip>): ClipPreview => ({ [clip.id]: { trackId: trackIds[own.trackIndex], fields } })
      switch (handle) {
        case 'body':
          preview = moveClips(group, clip, dt, trackIndexAt(ctx, ev.clientY) - startTrack, trackIds, snap, trackKinds)
          break
        case 'trim-start':
          preview = only(trimStart(clip, snap(clip.start + dt), trim))
          break
        case 'trim-end':
          preview = only(
            (stretch && stretchEnd(clip, snap(clip.start + clip.duration + dt), project.bpm, trim.rate)) ||
              trimEnd(clip, snap(clip.start + clip.duration + dt), trim),
          )
          break
        // Sideways sets the fade's length; up and down bend its curve.
        case 'fade-in':
          preview = only({ ...setFadeIn(clip, clip.fadeIn + dt), ...fadeCurve('fadeInCurve', clip.fadeInCurve, ev.clientY - y0) })
          break
        case 'fade-out':
          preview = only({ ...setFadeOut(clip, clip.fadeOut - dt), ...fadeCurve('fadeOutCurve', clip.fadeOutCurve, ev.clientY - y0) })
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
      if (ev && !moved && handle === 'body' && e.pointerType === 'touch' && !razor) {
        // A tap on a clip (touch screens): its floating menu.
        useViewStore.getState().setClipBubble({ clipId: clip.id, x: ev.clientX, y: ev.clientY })
        return
      }
      if (ev && !moved && razor) {
        // Cuts the clicked clip, and the other selected clips the cut runs through.
        const at = razorTime(ctx, ev.clientX)
        const ids = useViewStore.getState().selection.includes(clip.id) ? useViewStore.getState().selection : [clip.id]
        splitClips(ids, at)
        return
      }
      if (ev && !moved && e.altKey && (handle === 'fade-in' || handle === 'fade-out')) {
        // Alt+click a fade handle: a fade of exactly one grid step, or back to none.
        const step = snapStep(project.snap, project.bpm, project.timeSignature) ?? secondsPerBeat(project.bpm, project.timeSignature)
        const fields = handle === 'fade-in' ? setFadeIn(clip, clip.fadeIn > 0 ? 0 : step) : setFadeOut(clip, clip.fadeOut > 0 ? 0 : step)
        applyClipEdits(LABELS[handle], [{ clipId: clip.id, trackId: trackIds[own.trackIndex], fields }])
        return
      }
      if (!ev || !moved || !preview) return
      const edits = Object.entries(preview).map(([clipId, entry]) => ({ clipId, trackId: entry.trackId, fields: entry.fields }))
      const label = stretch ? 'Stretch clip' : handle === 'body' && edits.length > 1 ? 'Move clips' : LABELS[handle]
      applyClipEdits(label, edits)
    },
    handle === 'body' ? 'grabbing' : handle === 'gain' ? 'ns-resize' : 'ew-resize',
  )
}

/** Drag a track header's grip to move the track; shows the insertion point while dragging. */
export function startTrackReorder(e: React.PointerEvent, trackId: string, ctx: GestureContext) {
  if (e.button !== 0) return
  e.preventDefault()
  const count = useProjectStore.getState().project.tracks.length
  const from = useProjectStore.getState().project.tracks.findIndex((t) => t.id === trackId)
  const insertionAt = (clientY: number) =>
    Math.min(count, Math.max(0, Math.round((clientY - ctx.lanes.getBoundingClientRect().top) / ctx.rowHeight)))

  track(
    e,
    (ev) => useViewStore.getState().setTrackDrop(insertionAt(ev.clientY)),
    (ev, moved) => {
      useViewStore.getState().setTrackDrop(null)
      if (!ev || !moved) return
      const at = insertionAt(ev.clientY)
      // Dropping right above or below itself leaves the order unchanged.
      if (at !== from && at !== from + 1) moveTrack(trackId, at > from ? at - 1 : at)
    },
    'grabbing',
  )
}

/** Drag on empty lane space: rubber-band selection. A plain click deselects and moves the cursor. */
export function startLaneGesture(e: React.PointerEvent, ctx: GestureContext) {
  if (e.button !== 0) return
  if (e.pointerType === 'touch') {
    // The browser scrolls on a drag (and cancels the pointer); a tap moves the playhead.
    const t = timeAt(ctx, e.clientX)
    const tap = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', tap)
      window.removeEventListener('pointercancel', cancel)
      if (Math.abs(ev.clientX - e.clientX) < 8 && Math.abs(ev.clientY - e.clientY) < 8) {
        useViewStore.getState().setSelection([])
        seek(snapper(useProjectStore.getState().project, false)(t))
      }
    }
    const cancel = () => {
      window.removeEventListener('pointerup', tap)
      window.removeEventListener('pointercancel', cancel)
    }
    window.addEventListener('pointerup', tap)
    window.addEventListener('pointercancel', cancel)
    return
  }
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
