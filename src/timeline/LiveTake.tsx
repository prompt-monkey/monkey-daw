import { useEffect, useRef } from 'react'
import { useRecordingStore } from '../recording/store'
import { usePlayheadFrame } from './usePlayheadFrame'

/** The take being recorded on a track: grows with the playhead and draws levels as they arrive. */
export function LiveTake({ trackId, pps, height }: { trackId: string; pps: number; height: number }) {
  const live = useRecordingStore((s) => (s.live?.trackId === trackId ? s.live : null))
  const status = useRecordingStore((s) => s.status)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  usePlayheadFrame((t) => {
    if (box.current && live) box.current.style.width = `${Math.max(0, (t - live.start) * pps)}px`
  })

  useEffect(() => {
    const el = canvas.current
    if (!el || !live) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.ceil(live.peaks.length * live.peakDuration * pps))
    const h = Math.round((height - 4) * dpr)
    el.width = Math.round(width * dpr)
    el.height = h
    el.style.width = `${width}px`
    const g = el.getContext('2d')
    if (!g) return
    g.fillStyle = 'oklch(70% 0.19 25)'
    const step = live.peakDuration * pps * dpr
    live.peaks.forEach((peak, i) => {
      const amp = Math.min(1, peak) * (h / 2) * 0.95
      g.fillRect(i * step, h / 2 - amp, Math.max(1, step), Math.max(1, amp * 2))
    })
  }, [live, pps, height])

  if (!live) return null
  return (
    <div
      ref={box}
      className="pointer-events-none absolute top-0.5 overflow-hidden rounded-md border border-danger/70 bg-danger/15"
      style={{ left: live.start * pps, height: height - 4 }}
      aria-label={status === 'counting-in' ? 'Counting in' : 'Recording'}
    >
      <div className="px-1.5 text-[11px] font-semibold text-danger">{status === 'counting-in' ? 'Count-in…' : '● Recording'}</div>
      <canvas ref={canvas} className="absolute top-0 left-0 h-full" />
    </div>
  )
}
