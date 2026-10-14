import { useRef } from 'react'
import { engine } from '../audio/engine'
import { gainToDb } from '../model/levels'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'

/** RMS level, in dBFS, that reads 0 VU. */
const REFERENCE_DBFS = -18
const MIN_VU = -20
const MAX_VU = 3
/** VU ballistics: the needle settles over roughly 300 ms. */
const INTEGRATION = 0.3
/** Half of the needle's swing, in radians. */
const SWING = 0.82
const MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]

const angleFor = (vu: number) => ((Math.min(MAX_VU, Math.max(MIN_VU, vu)) - MIN_VU) / (MAX_VU - MIN_VU) - 0.5) * 2 * SWING

/** Analog-style VU meter for the master: RMS with needle ballistics. */
export function VuMeter({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef({ vu: MIN_VU, last: 0, drawnAt: NaN, area: 0 })

  usePlayheadFrame(() => {
    const canvas = ref.current
    if (!canvas) return
    const now = performance.now() / 1000
    const s = state.current
    const dt = s.last ? Math.min(0.1, now - s.last) : 0
    s.last = now
    const reading = engine.readMeter('master')
    const rms = reading ? Math.sqrt((reading.rms[0] ** 2 + reading.rms[1] ** 2) / 2) : 0
    const target = Math.max(MIN_VU - 2, gainToDb(rms) - REFERENCE_DBFS)
    s.vu += (target - s.vu) * (1 - Math.exp(-dt / INTEGRATION))

    const dpr = window.devicePixelRatio || 1
    const w = Math.round(canvas.clientWidth * dpr)
    const h = Math.round(canvas.clientHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const g = canvas.getContext('2d')
    if (!g || !w || !h) return
    // Skip redraws while the needle is at rest.
    if (Math.abs(s.vu - s.drawnAt) < 0.01 && s.area === w * h) return
    s.drawnAt = s.vu
    s.area = w * h
    const styles = getComputedStyle(canvas)
    const ink = styles.getPropertyValue('--color-text-dim')
    const accent = styles.getPropertyValue('--color-accent')
    const danger = styles.getPropertyValue('--color-danger')

    g.clearRect(0, 0, w, h)
    const cx = w / 2
    const cy = h * 1.05
    const radius = Math.min(h * 0.95, w * 0.62)
    g.lineCap = 'round'
    // Scale arc, red from 0 VU up.
    g.lineWidth = 1.5 * dpr
    g.strokeStyle = ink
    g.beginPath()
    g.arc(cx, cy, radius, -Math.PI / 2 + angleFor(MIN_VU), -Math.PI / 2 + angleFor(0))
    g.stroke()
    g.strokeStyle = danger
    g.lineWidth = 3 * dpr
    g.beginPath()
    g.arc(cx, cy, radius, -Math.PI / 2 + angleFor(0), -Math.PI / 2 + angleFor(MAX_VU))
    g.stroke()
    // Tick marks.
    g.lineWidth = 1 * dpr
    for (const mark of MARKS) {
      const a = angleFor(mark) - Math.PI / 2
      const major = mark === 0 || mark === -20 || mark === 3
      g.strokeStyle = mark > 0 ? danger : ink
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)
      g.lineTo(cx + Math.cos(a) * (radius - (major ? 8 : 5) * dpr), cy + Math.sin(a) * (radius - (major ? 8 : 5) * dpr))
      g.stroke()
    }
    g.fillStyle = ink
    g.font = `${9 * dpr}px ${styles.getPropertyValue('--font-mono')}`
    g.textAlign = 'center'
    g.fillText('VU', cx, h - 4 * dpr)
    // Needle.
    const a = angleFor(s.vu) - Math.PI / 2
    g.strokeStyle = accent
    g.lineWidth = 1.5 * dpr
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(cx + Math.cos(a) * (radius + 2 * dpr), cy + Math.sin(a) * (radius + 2 * dpr))
    g.stroke()
  })

  return <canvas ref={ref} className={`block ${className}`} role="img" aria-label="Master VU meter" />
}
