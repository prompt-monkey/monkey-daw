import { useEffect, useRef } from 'react'
import { formatValue, fromNormalized, toNormalized, type NumberParam } from '../effects/definitions'

interface Props {
  def: NumberParam
  value: number
  onChange: (value: number) => void
  /** Called when a gesture ends (pointer up, wheel pause, key up), to close the undo step. */
  onCommit?: () => void
  disabled?: boolean
  /** Text shown instead of the value (e.g. a synced delay time). */
  display?: string
  /** Driven by automation: shows an "A" badge and can't be moved by hand. */
  automated?: boolean
  onContextMenu?: (e: React.MouseEvent) => void
}

/** Pixels of vertical drag for the full range; hold Shift for fine control. */
const DRAG_RANGE = 180
const FINE = 8
const ARC = 270
const START = 135

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }
  const [x1, y1] = point(from)
  const [x2, y2] = point(to)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

/**
 * Rotary knob: drag up/down or use the wheel; Shift for fine steps; double-click resets;
 * arrow keys, Page Up/Down, Home and End work when focused.
 */
export function Knob({ def, value, onChange, onCommit, disabled: off, display, automated, onContextMenu }: Props) {
  const disabled = off || automated
  const renderedPosition = Math.min(1, Math.max(0, toNormalized(def, value)))
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest position, so key presses and wheel ticks arriving before a re-render still add up.
  const latest = useRef(renderedPosition)
  useEffect(() => {
    latest.current = renderedPosition
  }, [renderedPosition])
  const position = renderedPosition
  const set = (p: number) => {
    latest.current = Math.min(1, Math.max(0, p))
    onChange(fromNormalized(def, latest.current))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    let last = e.clientY
    let current = position
    const move = (ev: PointerEvent) => {
      current = Math.min(1, Math.max(0, current + (last - ev.clientY) / (DRAG_RANGE * (ev.shiftKey ? FINE : 1))))
      last = ev.clientY
      set(current)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      onCommit?.()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return
    set(latest.current + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.002 : 0.02))
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    wheelTimer.current = setTimeout(() => onCommit?.(), 400)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.002 : 0.02
    const from = latest.current
    const moves: Record<string, number> = {
      ArrowUp: from + step,
      ArrowRight: from + step,
      ArrowDown: from - step,
      ArrowLeft: from - step,
      PageUp: from + 0.1,
      PageDown: from - 0.1,
      Home: 0,
      End: 1,
    }
    if (!(e.key in moves) || disabled) return
    e.preventDefault()
    e.stopPropagation()
    set(moves[e.key])
  }

  const angle = START + position * ARC
  const size = 40
  const c = size / 2
  return (
    <div className={`flex w-16 flex-col items-center gap-0.5 ${off ? 'opacity-40' : ''}`} onContextMenu={onContextMenu}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={display ?? formatValue(def, value)}
        aria-disabled={disabled}
        className={`touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${disabled ? 'cursor-default' : 'cursor-ns-resize'}`}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={() => onCommit?.()}
        onDoubleClick={() => {
          if (disabled) return
          onChange(def.default)
          onCommit?.()
        }}
        title={
          automated
            ? `${def.label}: ${display ?? formatValue(def, value)} · automated: edit the lane on the timeline`
            : `${def.label}: ${display ?? formatValue(def, value)} · drag or scroll, Shift for fine, double-click to reset`
        }
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path d={arcPath(c, c, 15, START, START + ARC)} stroke="var(--color-line)" strokeWidth={4} fill="none" strokeLinecap="round" />
          {position > 0.001 && (
            <path d={arcPath(c, c, 15, START, angle)} stroke="var(--color-accent)" strokeWidth={4} fill="none" strokeLinecap="round" />
          )}
          <circle cx={c} cy={c} r={10} fill="var(--color-surface-2)" />
          <line
            x1={c}
            y1={c}
            x2={c + 9 * Math.cos((angle * Math.PI) / 180)}
            y2={c + 9 * Math.sin((angle * Math.PI) / 180)}
            stroke="var(--color-text)"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="text-[10px] text-text-dim">
        {def.label}
        {automated && <span className="ml-0.5 font-bold text-accent">A</span>}
      </span>
      <span className="font-mono text-[10px]">{display ?? formatValue(def, value)}</span>
    </div>
  )
}
