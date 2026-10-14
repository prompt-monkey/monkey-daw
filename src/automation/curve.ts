// Automation curve math. Pure, so it is unit-tested. Values are 0–1 positions on the target's
// own control scale; times are timeline seconds.

import type { AutomationPoint } from '../model/types'

/** How strongly a curve of ±1 bends a segment. */
const BEND = 6

/** Shapes a 0–1 position along a segment: 0 is linear, >0 starts slow, <0 starts fast. */
export function shape(x: number, curve: number): number {
  if (Math.abs(curve) < 1e-3) return x
  const k = curve * BEND
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1)
}

/** Inverse of shape: which position along the segment gives a shaped fraction `y`. */
export function inverseShape(y: number, curve: number): number {
  if (Math.abs(curve) < 1e-3) return y
  const k = curve * BEND
  return Math.log(1 + y * (Math.exp(k) - 1)) / k
}

/**
 * Value at a time: held at the first point's value before it and the last point's value after
 * it, shaped between points. Null when the lane has no points.
 */
export function valueAt(points: AutomationPoint[], time: number): number | null {
  if (!points.length) return null
  if (time <= points[0].time) return points[0].value
  const last = points[points.length - 1]
  if (time >= last.time) return last.value
  // Binary search for the segment containing `time`.
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].time <= time) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const span = b.time - a.time
  if (span <= 0) return b.value
  return a.value + (b.value - a.value) * shape((time - a.time) / span, a.curve)
}

export interface Sample {
  time: number
  value: number
}

/**
 * Samples a lane across [from, to] for scheduling as linear ramps: every point inside the range,
 * plus intermediate samples on curved segments and at least every `step` seconds, so the
 * ramps follow the curve closely.
 */
export function sampleRange(points: AutomationPoint[], from: number, to: number, step = 0.01): Sample[] {
  if (!points.length || to < from) return []
  const times = new Set<number>([from, to])
  for (const p of points) if (p.time > from && p.time < to) times.add(p.time)
  for (let t = Math.ceil(from / step) * step; t < to; t += step) times.add(Number(t.toFixed(6)))
  return [...times].sort((a, b) => a - b).map((time) => ({ time, value: valueAt(points, time)! }))
}

/** Midpoint of a segment, where its bend handle is drawn. */
export function segmentMidpoint(a: AutomationPoint, b: AutomationPoint): Sample {
  const time = (a.time + b.time) / 2
  return { time, value: a.value + (b.value - a.value) * shape(0.5, a.curve) }
}

/**
 * The curve that puts a segment's midpoint at `midValue` (dragging the bend handle). Flat
 * segments can't bend, so they stay at 0.
 */
export function curveForMidpoint(a: AutomationPoint, b: AutomationPoint, midValue: number): number {
  const range = b.value - a.value
  if (Math.abs(range) < 1e-6) return 0
  const y = Math.min(0.98, Math.max(0.02, (midValue - a.value) / range))
  // Solve shape(0.5, c) = y. shape(0.5) = 1 / (e^(k/2) + 1), so e^(k/2) = 1/y - 1.
  const k = 2 * Math.log(1 / y - 1)
  return Math.min(1, Math.max(-1, k / BEND))
}

/** Inserts a point keeping the list sorted; a point at the same time replaces the old one. */
export function insertPoint(points: AutomationPoint[], point: AutomationPoint): AutomationPoint[] {
  const out = points.filter((p) => Math.abs(p.time - point.time) > 1e-6)
  out.push(point)
  return out.sort((a, b) => a.time - b.time)
}
