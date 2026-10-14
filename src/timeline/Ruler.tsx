// Ruler: bar/beat ticks (canvas, redrawn for the visible span only), the loop strip on top and
// a seek area below. Drag in the loop strip to create a loop, drag its edges or middle to adjust
// it, double-click it to turn the loop off. Click or drag below to move the playhead.

import { useEffect, useRef, useState } from 'react'
import { snapTime } from '../model/grid'
import type { LoopRegion } from '../model/types'
import { setLoop } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { seek, useTransportStore } from '../state/transport'
import { LOOP_STRIP_HEIGHT, RULER_HEIGHT, rulerTicks } from './geometry'
import { usePlayheadFrame } from './usePlayheadFrame'

const EDGE_GRAB_PX = 6

interface Props {
  pps: number
  /** Width of the scrollable timeline area (excluding the header column). */
  width: number
  /** The timeline's scroll container; the ruler redraws for its visible span. */
  scroller: HTMLElement | null
  /** Width of the track header column, left of the ruler. */
  headerWidth: number
}

/** Scroll offset and width of the scroll container, updated on scroll and resize. */
function useScrollBox(scroller: HTMLElement | null) {
  const [box, setBox] = useState({ scrollLeft: 0, width: 0 })
  useEffect(() => {
    if (!scroller) return
    const update = () => setBox({ scrollLeft: scroller.scrollLeft, width: scroller.clientWidth })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    scroller.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', update)
    }
  }, [scroller])
  return box
}

export function Ruler({ pps, width, scroller, headerWidth }: Props) {
  const { scrollLeft, width: viewportWidth } = useScrollBox(scroller)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const bpm = useProjectStore((s) => s.project.bpm)
  const ts = useProjectStore((s) => s.project.timeSignature)
  const snapMode = useProjectStore((s) => s.project.snap)
  const loop = useProjectStore((s) => s.project.loop)
  const [loopDraft, setLoopDraft] = useState<LoopRegion | null>(null)
  const shownLoop = loopDraft ?? loop
  const visibleWidth = Math.max(0, viewportWidth - headerWidth)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || visibleWidth <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(visibleWidth * dpr)
    canvas.height = Math.round(RULER_HEIGHT * dpr)
    const g = canvas.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, visibleWidth, RULER_HEIGHT)
    const styles = getComputedStyle(canvas)
    const strong = styles.getPropertyValue('--color-text-dim')
    const faint = styles.getPropertyValue('--color-grid-bar')
    g.font = '10px ' + styles.getPropertyValue('--font-mono')
    g.textBaseline = 'top'
    const t0 = scrollLeft / pps
    const t1 = (scrollLeft + visibleWidth) / pps
    for (const tick of rulerTicks(pps, bpm, ts, t0, t1)) {
      const x = Math.round(tick.time * pps - scrollLeft) + 0.5
      const labelled = tick.label !== undefined
      g.fillStyle = labelled ? strong : faint
      const top = tick.kind === 'bar' ? (labelled ? LOOP_STRIP_HEIGHT : RULER_HEIGHT - 12) : RULER_HEIGHT - 7
      g.fillRect(x, top, 1, RULER_HEIGHT - top)
      if (labelled) {
        g.fillStyle = strong
        g.fillText(tick.label!, x + 4, LOOP_STRIP_HEIGHT + 3)
      }
    }
  }, [pps, bpm, ts, scrollLeft, visibleWidth])

  usePlayheadFrame((t) => {
    if (markerRef.current) markerRef.current.style.transform = `translateX(${t * pps}px)`
  })

  const timeAt = (clientX: number) => (clientX - (areaRef.current?.getBoundingClientRect().left ?? 0)) / pps
  const snap = (t: number, free: boolean) => (free ? Math.max(0, t) : snapTime(t, snapMode, bpm, ts))

  const onSeekDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const go = (ev: { clientX: number; altKey: boolean }) => seek(snap(timeAt(ev.clientX), ev.altKey))
    // While playing, only restart playback on release, so scrubbing doesn't stutter.
    const scrub = (ev: PointerEvent) => {
      const t = snap(timeAt(ev.clientX), ev.altKey)
      if (useTransportStore.getState().playing) {
        if (markerRef.current) markerRef.current.style.transform = `translateX(${t * pps}px)`
      } else seek(t)
    }
    go(e)
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', scrub)
      target.removeEventListener('pointerup', up)
      if (useTransportStore.getState().playing) go(ev)
    }
    target.addEventListener('pointermove', scrub)
    target.addEventListener('pointerup', up)
  }

  const onLoopDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.detail > 1) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const t = timeAt(e.clientX)
    const grab = EDGE_GRAB_PX / pps
    const active = loop.enabled
    let mode: 'start' | 'end' | 'move' | 'create' = 'create'
    if (active && Math.abs(t - loop.start) <= grab) mode = 'start'
    else if (active && Math.abs(t - loop.end) <= grab) mode = 'end'
    else if (active && t > loop.start && t < loop.end) mode = 'move'
    const anchor = snap(t, e.altKey)
    let draft: LoopRegion | null = null

    const move = (ev: PointerEvent) => {
      const now = snap(timeAt(ev.clientX), ev.altKey)
      if (mode === 'create') draft = { enabled: true, start: Math.min(anchor, now), end: Math.max(anchor, now) }
      else if (mode === 'start') draft = { ...loop, start: Math.min(now, loop.end - 0.05) }
      else if (mode === 'end') draft = { ...loop, end: Math.max(now, loop.start + 0.05) }
      else {
        const shift = Math.max(-loop.start, snap(loop.start + (timeAt(ev.clientX) - t), ev.altKey) - loop.start)
        draft = { ...loop, start: loop.start + shift, end: loop.end + shift }
      }
      setLoopDraft(draft)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      setLoopDraft(null)
      if (draft && draft.end - draft.start >= 0.05) setLoop(draft)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <div ref={areaRef} className="relative border-b border-line bg-surface" style={{ width, height: RULER_HEIGHT }}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none sticky top-0 block"
        style={{ left: headerWidth, width: visibleWidth, height: RULER_HEIGHT }}
      />
      <div
        className="absolute inset-x-0 top-0 cursor-pointer hover:bg-text/5"
        style={{ height: LOOP_STRIP_HEIGHT }}
        onPointerDown={onLoopDown}
        onDoubleClick={() => loop.enabled && setLoop({ enabled: false })}
        title="Drag to set the loop · double-click to turn it off"
      >
        <div
          className={`absolute inset-y-0.5 rounded-sm ${shownLoop.enabled ? 'bg-accent/70' : 'bg-text/15'}`}
          style={{ left: shownLoop.start * pps, width: (shownLoop.end - shownLoop.start) * pps }}
        />
      </div>
      <div
        className="absolute inset-x-0 bottom-0 cursor-text"
        style={{ top: LOOP_STRIP_HEIGHT }}
        onPointerDown={onSeekDown}
        title="Click or drag to move the playhead"
      />
      <div ref={markerRef} className="pointer-events-none absolute top-0 left-0 h-full">
        <div className="absolute bottom-0 -left-1.5 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-accent" />
        <div className="absolute top-0 bottom-0 left-0 w-px bg-accent" />
      </div>
    </div>
  )
}
