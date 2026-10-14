import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { createTestTone } from '../dev/testTone'
import { projectLength } from '../model/factory'
import { snapTime } from '../model/grid'
import type { Clip, Track } from '../model/types'
import { addAudioClip, addTrack, addTrackWithClip, applyClipEdits } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { playheadPosition, useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { placeSample, SAMPLE_DRAG_TYPE } from '../library/audio'
import { toast } from '../ui/toast'
import { ClipView, type ClipHandle } from './ClipView'
import { LiveTake } from './LiveTake'
import { trackColor } from './colors'
import { applyPreview } from './edits'
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHTS, clampPps, laneGridBackground } from './geometry'
import { startClipGesture, startLaneGesture, startTrackReorder, type GestureContext } from './gestures'
import { Ruler } from './Ruler'
import { TrackHeader } from './TrackHeader'
import { usePlayheadFrame } from './usePlayheadFrame'

/** Empty space kept after the last clip, in seconds. */
const TAIL_SECONDS = 30
const AUDIO_FILE = /\.(wav|mp3)$/i

async function importFiles(files: File[], onAsset: (asset: Awaited<ReturnType<typeof engine.assets.importFile>>) => void) {
  for (const file of files.filter((f) => AUDIO_FILE.test(f.name))) {
    try {
      onAsset(await engine.assets.importFile(file, engine.context))
    } catch {
      alert(`Could not read "${file.name}". Use a WAV or MP3 file.`)
    }
  }
}

function TimelineToolbar({ onFit }: { onFit: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const pps = useViewStore((s) => s.pps)
  const trackHeight = useViewStore((s) => s.trackHeight)
  const follow = useViewStore((s) => s.followPlayhead)
  const view = useViewStore.getState()
  const btn = 'shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] leading-4 hover:bg-surface-2'

  const addTone = () => {
    const { project } = useProjectStore.getState()
    const target = project.tracks.find((t) => t.clips.length === 0) ?? project.tracks[0]
    const n = Object.keys(project.assets).length
    const buffer = createTestTone(engine.context, [220, 277.18, 329.63, 392, 440][n % 5], project.bpm)
    const asset = engine.assets.add(`Test tone ${n + 1}`, buffer)
    if (target) addAudioClip(target.id, asset, useTransportStore.getState().cursor)
    else addTrackWithClip(asset, useTransportStore.getState().cursor)
  }

  return (
    <div
      className="sticky left-0 z-50 flex shrink-0 items-center gap-1 border-r border-b border-line bg-surface px-1.5"
      style={{ width: HEADER_WIDTH, height: RULER_HEIGHT }}
    >
      <button className={btn} onClick={() => fileRef.current?.click()} title="Import WAV or MP3 files, each into a new track">
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void importFiles(files, (asset) => addTrackWithClip(asset, useTransportStore.getState().cursor))
        }}
      />
      {import.meta.env.DEV && (
        <button className={btn} onClick={addTone} title="Development: add a synthesized clip">
          + Tone
        </button>
      )}
      <span className="flex-1" />
      <button className={btn} onClick={() => view.setPps(pps / 1.5)} title="Zoom out (Ctrl + wheel)">
        −
      </button>
      <button className={btn} onClick={() => view.setPps(pps * 1.5)} title="Zoom in (Ctrl + wheel)">
        +
      </button>
      <button className={btn} onClick={onFit} title="Fit the project in view">
        Fit
      </button>
      <button
        className={`${btn} ${follow ? 'bg-surface-2 text-accent' : ''}`}
        onClick={() => view.setFollowPlayhead(!follow)}
        aria-pressed={follow}
        title="Follow the playhead while playing"
      >
        ⇥
      </button>
      <button
        className={btn}
        onClick={() => view.setTrackHeight(trackHeight === 'normal' ? 'compact' : 'normal')}
        title={trackHeight === 'normal' ? 'Compact track height' : 'Normal track height'}
      >
        {trackHeight === 'normal' ? '▭' : '▤'}
      </button>
    </div>
  )
}

interface LaneProps {
  track: Track
  index: number
  width: number
  height: number
  grid: React.CSSProperties
  pps: number
  selection: string[]
  gestureContext: () => GestureContext | null
}

function Lane({ track, index, width, height, grid, pps, selection, gestureContext }: LaneProps) {
  const color = trackColor(index)
  const onClipDown = useCallback(
    (e: React.PointerEvent, clip: Clip, handle: ClipHandle) => {
      const ctx = gestureContext()
      if (ctx) startClipGesture(e, clip, handle, ctx)
    },
    [gestureContext],
  )
  const onResetGain = useCallback(
    (clip: Clip) => applyClipEdits('Reset clip gain', [{ clipId: clip.id, trackId: track.id, fields: { gain: 1 } }]),
    [track.id],
  )

  return (
    <div
      className="relative shrink-0 border-b border-line"
      style={{ width, height, ...grid }}
      onPointerDown={(e) => {
        const ctx = gestureContext()
        if (ctx && e.target === e.currentTarget) startLaneGesture(e, ctx)
      }}
    >
      {track.clips.map((clip) => (
        <ClipView
          key={clip.id}
          clip={clip}
          color={color}
          pps={pps}
          height={height}
          selected={selection.includes(clip.id)}
          onPointerDown={onClipDown}
          onResetGain={onResetGain}
        />
      ))}
      <LiveTake trackId={track.id} pps={pps} height={height} />
    </div>
  )
}

export function Timeline() {
  // The element is kept in state (so the ruler can subscribe to it) and in a ref (for writes).
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el
    setScroller(el)
  }, [])
  const lanesRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<{ time: number; px: number } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)

  const project = useProjectStore((s) => s.project)
  const { pps, trackHeight, selection, preview, marquee, trackDrop } = useViewStore()
  const rowHeight = TRACK_HEIGHTS[trackHeight]
  const tracks = useMemo(() => applyPreview(project.tracks, preview), [project.tracks, preview])
  const grid = useMemo(() => laneGridBackground(pps, project.bpm, project.timeSignature), [pps, project.bpm, project.timeSignature])

  const seconds = Math.max(
    projectLength({ ...project, tracks }) + TAIL_SECONDS,
    project.loop.end + 10,
    (viewportWidth - HEADER_WIDTH) / pps + 1,
  )
  const laneWidth = seconds * pps
  const contentWidth = HEADER_WIDTH + laneWidth

  const gestureContext = useCallback(
    (): GestureContext | null => (lanesRef.current ? { pps, rowHeight, lanes: lanesRef.current } : null),
    [pps, rowHeight],
  )
  const onGripDown = useCallback(
    (e: React.PointerEvent, trackId: string) => {
      const ctx = gestureContext()
      if (ctx) startTrackReorder(e, trackId, ctx)
    },
    [gestureContext],
  )

  useEffect(() => {
    if (!scroller) return
    const observer = new ResizeObserver(() => setViewportWidth(scroller.clientWidth))
    observer.observe(scroller)
    // Ctrl/Cmd + wheel zooms around the pointer; a plain wheel scrolls as usual.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const px = e.clientX - scroller.getBoundingClientRect().left - HEADER_WIDTH
      const current = useViewStore.getState().pps
      zoomAnchor.current = { time: (scroller.scrollLeft + px) / current, px }
      useViewStore.getState().setPps(current * Math.exp(-e.deltaY * 0.0015))
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('wheel', onWheel)
    }
  }, [scroller])

  // After a zoom renders, scroll so the time under the pointer stays put.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const el = scrollerRef.current
    if (!anchor || !el) return
    zoomAnchor.current = null
    el.scrollLeft = Math.max(0, anchor.time * pps - anchor.px)
  }, [pps])

  usePlayheadFrame((t) => {
    const x = t * pps
    if (lineRef.current) lineRef.current.style.transform = `translateX(${x}px)`
    const el = scrollerRef.current
    if (!el || !useTransportStore.getState().playing || !useViewStore.getState().followPlayhead) return
    const visible = el.clientWidth - HEADER_WIDTH
    if (x > el.scrollLeft + visible - 24 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 48)
  })

  const fit = () => {
    const el = scrollerRef.current
    if (!el) return
    const length = Math.max(projectLength(project), project.loop.enabled ? project.loop.end : 0, 8)
    useViewStore.getState().setPps(clampPps((el.clientWidth - HEADER_WIDTH - 32) / length))
    el.scrollLeft = 0
  }

  const acceptsDrop = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(SAMPLE_DRAG_TYPE)

  // Files or library samples dropped on a track land there, at the snapped drop time; dropped
  // below the last track they go on a new track.
  const onDrop = (e: React.DragEvent) => {
    if (!acceptsDrop(e) || !lanesRef.current) return
    e.preventDefault()
    const rect = lanesRef.current.getBoundingClientRect()
    const { project } = useProjectStore.getState()
    const time = (e.clientX - rect.left - HEADER_WIDTH) / pps
    const start = e.altKey ? Math.max(0, time) : snapTime(time, project.snap, project.bpm, project.timeSignature)
    const target = project.tracks[Math.floor((e.clientY - rect.top) / rowHeight)]
    const sampleId = e.dataTransfer.getData(SAMPLE_DRAG_TYPE)
    if (sampleId) {
      placeSample(sampleId, start, target?.id ?? null).catch((err) =>
        toast(`Could not add the sample: ${err instanceof Error ? err.message : 'unknown error'}`, 'error'),
      )
      return
    }
    let at = start
    void importFiles(Array.from(e.dataTransfer.files), (asset) => {
      if (target) addAudioClip(target.id, asset, at)
      else addTrackWithClip(asset, at)
      at += asset.duration
    })
  }

  return (
    <div ref={attachScroller} className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg" data-timeline>
      <div
        className="relative min-h-full"
        style={{ width: contentWidth }}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={onDrop}
      >
        <div className="sticky top-0 z-40 flex">
          <TimelineToolbar onFit={fit} />
          <Ruler pps={pps} width={laneWidth} scroller={scroller} />
        </div>

        <div ref={lanesRef} className="relative">
          {tracks.map((track, i) => (
            <div key={track.id} className="flex">
              <TrackHeader
                track={track}
                index={i}
                color={trackColor(i)}
                compact={trackHeight === 'compact'}
                height={rowHeight}
                onGripDown={onGripDown}
              />
              <Lane
                track={track}
                index={i}
                width={laneWidth}
                height={rowHeight}
                grid={grid}
                pps={pps}
                selection={selection}
                gestureContext={gestureContext}
              />
            </div>
          ))}

          {project.loop.enabled && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 border-x border-accent/40 bg-accent/5"
              style={{ left: HEADER_WIDTH + project.loop.start * pps, width: (project.loop.end - project.loop.start) * pps }}
            />
          )}
          {trackDrop !== null && (
            <div
              className="pointer-events-none absolute right-0 left-0 z-40 h-0.5 -translate-y-1/2 bg-accent"
              style={{ top: trackDrop * rowHeight }}
            />
          )}
          {marquee && (
            <div
              className="pointer-events-none absolute z-20 border border-accent bg-accent/10"
              style={{
                left: HEADER_WIDTH + Math.min(marquee.t0, marquee.t1) * pps,
                width: Math.abs(marquee.t1 - marquee.t0) * pps,
                top: Math.max(0, Math.min(marquee.track0, marquee.track1)) * rowHeight,
                height: (Math.abs(marquee.track1 - marquee.track0) + 1) * rowHeight,
              }}
            />
          )}
        </div>

        <div className="sticky left-0 p-3" style={{ width: HEADER_WIDTH }}>
          <button onClick={() => addTrack()} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
            + Add track
          </button>
        </div>

        <div
          ref={lineRef}
          className="pointer-events-none absolute bottom-0 z-20 w-px bg-accent"
          style={{ left: HEADER_WIDTH, top: RULER_HEIGHT, transform: `translateX(${playheadPosition() * pps}px)` }}
        />
      </div>
    </div>
  )
}
