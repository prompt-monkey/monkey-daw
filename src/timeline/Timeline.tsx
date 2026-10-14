import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { createTestTone } from '../dev/testTone'
import { projectLength } from '../model/factory'
import { secondsPerBar, snapTime } from '../model/grid'
import { isMidiClip, type Clip, type Track } from '../model/types'
import { addAudioClip, addMidiClip, addTrack, addTrackWithClip, applyClipEdits } from '../state/actions'
import { MIDI_FILE, importMidiAsTracks } from '../midi/importMidi'
import { useProjectStore } from '../state/projectStore'
import { playheadPosition, useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { placeSample, SAMPLE_DRAG_TYPE } from '../library/audio'
import { toast } from '../ui/toast'
import { ClipMenu, type ClipMenuState } from './ClipMenu'
import { ClipView, type ClipHandle } from './ClipView'
import { LaneView } from '../automation/LaneView'
import { LiveTake } from './LiveTake'
import { trackColor } from './colors'
import { applyPreview } from './edits'
import { useHeaderWidth, useShellStore } from '../ui/shell'
import { RULER_HEIGHT, TRACK_HEIGHTS, clampPps, laneGridBackground } from './geometry'
import { startClipGesture, startLaneGesture, startTrackReorder, type GestureContext } from './gestures'
import { Ruler } from './Ruler'
import { TrackHeader } from './TrackHeader'
import { usePlayheadFrame } from './usePlayheadFrame'

/** Empty space kept after the last clip, in seconds. */
const TAIL_SECONDS = 30
const AUDIO_FILE = /\.(wav|mp3)$/i

/** Imports .mid files as new MIDI tracks, one after the other from `start`. */
async function importMidiFiles(files: File[], start: number) {
  for (const file of files.filter((f) => MIDI_FILE.test(f.name))) await importMidiAsTracks(file, start)
}

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
  const headerWidth = useHeaderWidth()
  const narrow = useShellStore((s) => s.narrow)
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
      style={{ width: headerWidth, height: RULER_HEIGHT }}
    >
      <button className={btn} onClick={() => fileRef.current?.click()} title="Import WAV, MP3 or MIDI files, each into a new track">
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.mp3,.mid,.midi,audio/wav,audio/mpeg,audio/midi"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          const at = useTransportStore.getState().cursor
          void importFiles(files, (asset) => addTrackWithClip(asset, at))
          void importMidiFiles(files, at)
        }}
      />
      {import.meta.env.DEV && !narrow && (
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
      {!narrow && (
        <button className={btn} onClick={onFit} title="Fit the project in view">
          Fit
        </button>
      )}
      <button
        className={`${btn} ${follow ? 'bg-surface-2 text-accent' : ''}`}
        onClick={() => view.setFollowPlayhead(!follow)}
        aria-pressed={follow}
        title="Follow the playhead while playing"
        hidden={narrow}
      >
        ⇥
      </button>
      <button
        hidden={narrow}
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
  /** Automation lane drawn over the clips, if the track is in automation view. */
  laneTarget?: string
  onClipMenu: (e: React.MouseEvent, clip: Clip, trackId: string) => void
}

function Lane({ track, index, width, height, grid, pps, selection, gestureContext, laneTarget, onClipMenu }: LaneProps) {
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
  const onOpen = useCallback(
    (clip: Clip) => isMidiClip(clip) && useViewStore.getState().openPianoRoll(track.id, clip.id),
    [track.id],
  )
  const onMenu = useCallback((e: React.MouseEvent, clip: Clip) => onClipMenu(e, clip, track.id), [onClipMenu, track.id])
  // Double-clicking empty space on a MIDI or drum track adds a one-bar clip there and opens it.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (track.kind === 'audio' || e.target !== e.currentTarget) return
    const { project } = useProjectStore.getState()
    const bar = secondsPerBar(project.bpm, project.timeSignature)
    const time = (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps
    const id = addMidiClip(track.id, Math.floor(Math.max(0, time) / bar) * bar)
    if (id) {
      useViewStore.getState().setSelection([id])
      useViewStore.getState().openPianoRoll(track.id, id)
    }
  }

  return (
    <div
      className="relative shrink-0 border-b border-line"
      style={{ width, height, ...grid }}
      onPointerDown={(e) => {
        const ctx = gestureContext()
        if (ctx && e.target === e.currentTarget) startLaneGesture(e, ctx)
      }}
      onDoubleClick={onDoubleClick}
      title={track.kind !== 'audio' && !track.clips.length ? `Double-click to add a ${track.kind === 'drums' ? 'drum' : 'MIDI'} clip` : undefined}
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
          onOpen={onOpen}
          onMenu={onMenu}
          noteRows={track.kit?.pads.map((p) => p.note)}
        />
      ))}
      <LiveTake trackId={track.id} pps={pps} height={height} />
      {laneTarget && <LaneView track={track} target={laneTarget} pps={pps} width={width} height={height} color={color} />}
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
  // Read by the wheel and pinch handlers, which are attached once.
  const headerWidthRef = useRef(0)
  const [viewportWidth, setViewportWidth] = useState(0)

  const project = useProjectStore((s) => s.project)
  const { pps, trackHeight, selection, preview, marquee, trackDrop, automationView } = useViewStore()
  const rowHeight = TRACK_HEIGHTS[trackHeight]
  const headerWidth = useHeaderWidth()
  const tracks = useMemo(() => applyPreview(project.tracks, preview), [project.tracks, preview])
  const grid = useMemo(() => laneGridBackground(pps, project.bpm, project.timeSignature), [pps, project.bpm, project.timeSignature])

  const seconds = Math.max(
    projectLength({ ...project, tracks }) + TAIL_SECONDS,
    project.loop.end + 10,
    (viewportWidth - headerWidth) / pps + 1,
  )
  const laneWidth = seconds * pps
  const contentWidth = headerWidth + laneWidth

  const gestureContext = useCallback(
    (): GestureContext | null => (lanesRef.current ? { pps, rowHeight, lanes: lanesRef.current, headerWidth } : null),
    [pps, rowHeight, headerWidth],
  )
  const [clipMenu, setClipMenu] = useState<ClipMenuState | null>(null)
  const onClipMenu = useCallback((e: React.MouseEvent, clip: Clip, trackId: string) => {
    // Right-clicking a clip outside the selection selects it, like a click would.
    const view = useViewStore.getState()
    if (!view.selection.includes(clip.id)) view.setSelection([clip.id])
    setClipMenu({ clip, trackId, x: e.clientX, y: e.clientY })
  }, [])
  const onGripDown = useCallback(
    (e: React.PointerEvent, trackId: string) => {
      const ctx = gestureContext()
      if (ctx) startTrackReorder(e, trackId, ctx)
    },
    [gestureContext],
  )

  useEffect(() => {
    headerWidthRef.current = headerWidth
  }, [headerWidth])

  useEffect(() => {
    if (!scroller) return
    const observer = new ResizeObserver(() => setViewportWidth(scroller.clientWidth))
    observer.observe(scroller)
    /** Zooms by `factor`, keeping the time at `clientX` where it is. */
    const zoomAround = (clientX: number, pps: number) => {
      const px = clientX - scroller.getBoundingClientRect().left - headerWidthRef.current
      const current = useViewStore.getState().pps
      zoomAnchor.current = { time: (scroller.scrollLeft + px) / current, px }
      useViewStore.getState().setPps(pps)
    }
    // Ctrl/Cmd + wheel zooms around the pointer; a plain wheel scrolls as usual.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAround(e.clientX, useViewStore.getState().pps * Math.exp(-e.deltaY * 0.0015))
    }
    // Two fingers pinch to zoom (touch screens); one finger scrolls as usual.
    let pinch: { distance: number; pps: number } | null = null
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { distance: Math.max(1, spread(e.touches)), pps: useViewStore.getState().pps }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const mid = (e.touches[0].clientX + e.touches[1].clientX) / 2
      zoomAround(mid, pinch.pps * (spread(e.touches) / pinch.distance))
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: false })
    scroller.addEventListener('touchend', onTouchEnd)
    scroller.addEventListener('touchcancel', onTouchEnd)
    return () => {
      observer.disconnect()
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
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
    const visible = el.clientWidth - headerWidth
    if (x > el.scrollLeft + visible - 24 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 48)
  })

  const fit = () => {
    const el = scrollerRef.current
    if (!el) return
    const length = Math.max(projectLength(project), project.loop.enabled ? project.loop.end : 0, 8)
    useViewStore.getState().setPps(clampPps((el.clientWidth - headerWidth - 32) / length))
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
    const time = (e.clientX - rect.left - headerWidth) / pps
    const start = e.altKey ? Math.max(0, time) : snapTime(time, project.snap, project.bpm, project.timeSignature)
    const hit = project.tracks[Math.floor((e.clientY - rect.top) / rowHeight)]
    // Audio can only go on audio tracks; dropped on a MIDI track it gets a new track.
    const target = hit?.kind === 'audio' ? hit : undefined
    const sampleId = e.dataTransfer.getData(SAMPLE_DRAG_TYPE)
    if (sampleId) {
      placeSample(sampleId, start, target?.id ?? null).catch((err) =>
        toast(`Could not add the sample: ${err instanceof Error ? err.message : 'unknown error'}`, 'error'),
      )
      return
    }
    void importMidiFiles(Array.from(e.dataTransfer.files), start)
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
          <Ruler pps={pps} width={laneWidth} scroller={scroller} headerWidth={headerWidth} />
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
                laneTarget={automationView[track.id]}
                onClipMenu={onClipMenu}
              />
            </div>
          ))}

          {project.loop.enabled && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 border-x border-accent/40 bg-accent/5"
              style={{ left: headerWidth + project.loop.start * pps, width: (project.loop.end - project.loop.start) * pps }}
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
                left: headerWidth + Math.min(marquee.t0, marquee.t1) * pps,
                width: Math.abs(marquee.t1 - marquee.t0) * pps,
                top: Math.max(0, Math.min(marquee.track0, marquee.track1)) * rowHeight,
                height: (Math.abs(marquee.track1 - marquee.track0) + 1) * rowHeight,
              }}
            />
          )}
        </div>

        <div className="sticky left-0 flex flex-wrap gap-1.5 p-3" style={{ width: headerWidth }}>
          {(
            [
              ['audio', '+ Audio', 'Add an audio track: clips, samples and recordings'],
              ['midi', '+ MIDI', 'Add a MIDI track: notes played by an instrument'],
              ['drums', '+ Drums', 'Add a drum track: drum pads with a step sequencer'],
            ] as const
          ).map(([kind, label, title]) => (
            <button
              key={kind}
              onClick={() => addTrack(undefined, kind)}
              className="flex-1 rounded-md border border-line px-2 py-1.5 text-sm whitespace-nowrap hover:bg-surface-2"
              title={title}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          ref={lineRef}
          className="pointer-events-none absolute bottom-0 z-20 w-px bg-accent"
          style={{ left: headerWidth, top: RULER_HEIGHT, transform: `translateX(${playheadPosition() * pps}px)` }}
        />
      </div>
      <ClipMenu menu={clipMenu} onClose={() => setClipMenu(null)} />
    </div>
  )
}
