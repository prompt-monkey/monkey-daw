import { useRef } from 'react'
import { engine } from '../audio/engine'
import type { MeterReading } from '../audio/graph'
import { meterPosition } from '../model/levels'
import type { Id } from '../model/types'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'

/** How fast the bar falls, in meter-travel per second. */
const FALL_RATE = 1.6
/** How long a peak marker holds before falling, in seconds. */
const HOLD = 1.2

const GREEN = 'oklch(76% 0.15 150)'
const YELLOW = 'oklch(84% 0.15 95)'
const RED = 'oklch(66% 0.21 25)'
/** Meter positions where the colour changes (-12 dB and -3 dB on a -60…+6 scale). */
const YELLOW_FROM = 48 / 66
const RED_FROM = 57 / 66

interface Props {
  /** Channel to meter; ignored when `read` is given. */
  channelId?: Id | 'master'
  /** Custom level source, e.g. the recording input. */
  read?: () => MeterReading | null
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

/** Stereo peak meter with falling bars and peak hold, drawn on canvas every frame. */
export function LevelMeter({ channelId = 'master', read, orientation = 'vertical', className = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef({ level: [0, 0], hold: [0, 0], holdUntil: [0, 0], last: 0, idle: false })

  usePlayheadFrame(() => {
    const canvas = ref.current
    if (!canvas) return
    const now = performance.now() / 1000
    const s = state.current
    const dt = s.last ? Math.min(0.1, now - s.last) : 0
    s.last = now
    const reading = read ? read() : engine.readMeter(channelId)
    for (let i = 0; i < 2; i++) {
      const target = meterPosition(reading?.peak[i] ?? 0)
      s.level[i] = Math.max(target, s.level[i] - FALL_RATE * dt)
      if (target >= s.hold[i]) {
        s.hold[i] = target
        s.holdUntil[i] = now + HOLD
      } else if (now > s.holdUntil[i]) {
        s.hold[i] = Math.max(0, s.hold[i] - FALL_RATE * dt)
      }
    }

    const dpr = window.devicePixelRatio || 1
    const w = Math.round(canvas.clientWidth * dpr)
    const h = Math.round(canvas.clientHeight * dpr)
    const resized = canvas.width !== w || canvas.height !== h
    if (resized) {
      canvas.width = w
      canvas.height = h
    }
    // Once settled at silence, skip redrawing until there is signal again.
    const silent = s.level[0] + s.level[1] + s.hold[0] + s.hold[1] === 0
    if (silent && s.idle && !resized) return
    s.idle = silent
    const g = canvas.getContext('2d')
    if (!g || !w || !h) return
    g.clearRect(0, 0, w, h)
    const vertical = orientation === 'vertical'
    const length = vertical ? h : w
    const thickness = (vertical ? w : h) / 2
    const gap = Math.max(1, Math.round(dpr))
    for (let i = 0; i < 2; i++) {
      const across = i * thickness
      const bar = (from: number, to: number, color: string) => {
        if (to <= from) return
        g.fillStyle = color
        const a = from * length
        const b = to * length
        if (vertical) g.fillRect(across, h - b, thickness - gap, b - a)
        else g.fillRect(a, across, b - a, thickness - gap)
      }
      g.globalAlpha = 0.12
      bar(0, 1, GREEN)
      g.globalAlpha = 1
      const level = s.level[i]
      bar(0, Math.min(level, YELLOW_FROM), GREEN)
      bar(YELLOW_FROM, Math.min(level, RED_FROM), YELLOW)
      bar(RED_FROM, level, RED)
      if (s.hold[i] > 0.01) {
        const color = s.hold[i] >= RED_FROM ? RED : s.hold[i] >= YELLOW_FROM ? YELLOW : GREEN
        bar(Math.max(0, s.hold[i] - 0.012), s.hold[i], color)
      }
    }
  })

  return <canvas ref={ref} className={`block ${className}`} aria-hidden />
}
