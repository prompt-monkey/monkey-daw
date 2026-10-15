// The automation lane editor, drawn over a track's clips (or in a bus or master row).
//   Click empty space to add a point (and keep dragging to place it). Drag points to move them;
//   Alt places them freely, off the grid. Drag a segment's middle handle up or down to bend it,
//   double-click the handle to straighten it. Double-click a point to delete it.

import { memo } from 'react'
import { snapTime } from '../model/grid'
import type { AutomatedChannel, AutomationPoint, Id } from '../model/types'
import {
  addAutomationPoint,
  deleteAutomationPoint,
  moveAutomationPoint,
  setAutomationCurve,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { curveForMidpoint, segmentMidpoint, shape } from './curve'
import { resolveTarget } from './targets'

/** Space above and below the curve inside the lane, in pixels. */
const PAD = 8
/** Sub-steps drawn per curved segment. */
const CURVE_STEPS = 24

interface Props {
  channel: AutomatedChannel
  /** The channel's id: a track or bus id, or 'master'. */
  channelId: Id | 'master'
  target: string
  pps: number
  width: number
  height: number
  color: string
}

function startDrag(onMove: (ev: PointerEvent) => void) {
  const end = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    useProjectStore.getState().endGesture()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

export const LaneView = memo(function LaneView({ channel, channelId, target, pps, width, height, color }: Props) {
  const resolved = resolveTarget(channel, target)
  const points: AutomationPoint[] = channel.automation.find((l) => l.target === target)?.points ?? []
  if (!resolved) return null

  const usable = height - PAD * 2
  const x = (time: number) => time * pps
  const y = (value: number) => PAD + (1 - value) * usable
  const timeAt = (clientX: number, rect: DOMRect) => Math.max(0, (clientX - rect.left) / pps)
  const valueAtY = (clientY: number, rect: DOMRect) => Math.min(1, Math.max(0, 1 - (clientY - rect.top - PAD) / usable))
  const snap = (time: number, free: boolean) => {
    if (free) return time
    const { snap: mode, bpm, timeSignature } = useProjectStore.getState().project
    return snapTime(time, mode, bpm, timeSignature)
  }

  // The curve as a polyline: flat before the first and after the last point.
  let path = ''
  if (points.length) {
    const coords: string[] = [`0,${y(points[0].value)}`]
    points.forEach((p, i) => {
      coords.push(`${x(p.time)},${y(p.value)}`)
      const next = points[i + 1]
      if (next && Math.abs(p.curve) > 1e-3) {
        for (let s = 1; s < CURVE_STEPS; s++) {
          const f = s / CURVE_STEPS
          coords.push(`${x(p.time + f * (next.time - p.time))},${y(p.value + (next.value - p.value) * shape(f, p.curve))}`)
        }
      }
    })
    coords.push(`${width},${y(points[points.length - 1].value)}`)
    path = coords.join(' ')
  }

  const dragPoint = (index: number, rect: DOMRect) => {
    startDrag((ev) => moveAutomationPoint(channelId, target, index, snap(timeAt(ev.clientX, rect), ev.altKey), valueAtY(ev.clientY, rect)))
  }

  const onBackgroundDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const index = addAutomationPoint(channelId, target, {
      time: snap(timeAt(e.clientX, rect), e.altKey),
      value: valueAtY(e.clientY, rect),
      curve: 0,
    })
    // Adding and placing a point is one gesture: keep dragging the new point.
    if (index >= 0) dragPoint(index, rect)
  }

  const manualValue = resolved.fromReal(resolved.manual)

  return (
    <svg
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      width={width}
      height={height}
      onPointerDown={onBackgroundDown}
      role="group"
      aria-label={`${resolved.label} automation`}
    >
      <rect width={width} height={height} fill="rgb(0 0 0 / 0.45)" pointerEvents="none" />
      {points.length === 0 ? (
        <>
          <line x1={0} x2={width} y1={y(manualValue)} y2={y(manualValue)} stroke={color} strokeDasharray="4 4" opacity={0.6} pointerEvents="none" />
          <text x={8} y={Math.max(14, y(manualValue) - 6)} fill="var(--color-text-dim)" fontSize={11} pointerEvents="none">
            {resolved.label}: click to add points
          </text>
        </>
      ) : (
        <polyline points={path} fill="none" stroke={color} strokeWidth={2} pointerEvents="none" />
      )}

      {points.map((p, i) => {
        const next = points[i + 1]
        if (!next || Math.abs(next.value - p.value) < 1e-3 || x(next.time) - x(p.time) < 24) return null
        const mid = segmentMidpoint(p, next)
        return (
          <rect
            key={`m${i}`}
            x={x(mid.time) - 4}
            y={y(mid.value) - 4}
            width={8}
            height={8}
            rx={2}
            fill="var(--color-surface-2)"
            stroke={color}
            className="cursor-ns-resize"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              e.preventDefault()
              const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
              startDrag((ev) => setAutomationCurve(channelId, target, i, curveForMidpoint(p, next, valueAtY(ev.clientY, rect))))
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setAutomationCurve(channelId, target, i, 0)
              useProjectStore.getState().endGesture()
            }}
          >
            <title>Drag to bend · double-click to straighten</title>
          </rect>
        )
      })}

      {points.map((p, i) => (
        <circle
          key={`p${i}`}
          cx={x(p.time)}
          cy={y(p.value)}
          r={5}
          fill={color}
          stroke="var(--color-bg)"
          strokeWidth={1.5}
          className="cursor-move"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.preventDefault()
            dragPoint(i, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect())
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            deleteAutomationPoint(channelId, target, i)
          }}
        >
          <title>{`${resolved.format(p.value)} · drag to move (Alt: off the grid) · double-click to delete`}</title>
        </circle>
      ))}
    </svg>
  )
})
