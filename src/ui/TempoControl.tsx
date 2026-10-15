import { useEffect, useRef, useState } from 'react'
import { setBpm } from '../state/actions'
import { useProjectStore } from '../state/projectStore'

/** Pixels of vertical drag per BPM (Shift: ten times finer). */
const DRAG_PX = 4

/**
 * The tempo: wheel up/down for ±1 BPM (Shift ±5), drag up/down to sweep it (Shift fine), and
 * double-click to type it. Each wheel run or drag is one undo step.
 */
export function TempoControl({ className = '' }: { className?: string }) {
  const bpm = useProjectStore((s) => s.project.bpm)
  const endGesture = useProjectStore((s) => s.endGesture)
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const wheelEnd = useRef<number | undefined>(undefined)

  // A native listener, so the wheel can be stopped from scrolling the page.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = (e.shiftKey ? 5 : 1) * (e.deltaY < 0 || e.deltaX < 0 ? 1 : -1)
      setBpm(Math.round(useProjectStore.getState().project.bpm) + step)
      window.clearTimeout(wheelEnd.current)
      wheelEnd.current = window.setTimeout(() => useProjectStore.getState().endGesture(), 400)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [draft])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || draft !== null) return
    e.preventDefault()
    const y0 = e.clientY
    const start = bpm
    let moved = false
    const move = (ev: PointerEvent) => {
      const dy = y0 - ev.clientY
      if (!moved && Math.abs(dy) < 3) return
      moved = true
      const delta = dy / DRAG_PX / (ev.shiftKey ? 10 : 1)
      setBpm(ev.shiftKey ? Math.round((start + delta) * 10) / 10 : Math.round(start + delta))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) endGesture()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const commit = () => {
    const n = Number(draft)
    if (draft !== null && draft.trim() !== '' && Number.isFinite(n)) {
      setBpm(n)
      endGesture()
    }
    setDraft(null)
  }

  if (draft !== null) {
    return (
      <input
        type="number"
        aria-label="Tempo in BPM"
        autoFocus
        min={20}
        max={300}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(null)
        }}
        className={`rounded-md border border-accent bg-bg px-2 py-1 font-mono text-text ${className}`}
      />
    )
  }

  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label="Tempo in BPM"
      aria-valuenow={bpm}
      aria-valuemin={20}
      aria-valuemax={300}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setDraft(String(bpm))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 5 : 1
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          setBpm(Math.round(bpm) + (e.key === 'ArrowUp' ? step : -step))
          endGesture()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          setDraft(String(bpm))
        }
      }}
      title="Wheel or drag up/down · Shift = ±5 (fine when dragging) · double-click to type"
      className={`cursor-ns-resize touch-none rounded-md border border-line bg-bg px-2 py-1 text-right font-mono text-text select-none hover:border-text-dim ${className}`}
    >
      {Number.isInteger(bpm) ? bpm : bpm.toFixed(1)}
    </div>
  )
}
