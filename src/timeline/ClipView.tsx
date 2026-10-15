import { memo, useEffect, useRef, useState } from 'react'
import { peakRange } from '../audio/peaks'
import { usePeaks } from '../audio/peaksCache'
import { fadeShape } from '../audio/schedule'
import { snapTime } from '../model/grid'
import { beatSeconds } from '../model/midi'
import { clipRate } from '../model/tempo'
import { isMidiClip, type Clip, type Note } from '../model/types'
import { useProjectStore } from '../state/projectStore'
import { useLite } from '../ui/shell'
import { MAX_CLIP_GAIN, formatGain } from './edits'

export type ClipHandle = 'body' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out' | 'gain'

/** Backing-store width cap; wider clips stretch the waveform image. Lite mode draws less. */
const MAX_CANVAS_WIDTH = 4096
const LITE_CANVAS_WIDTH = 1024

/** Canvas resolution: the device's pixel ratio, or 1 in lite mode. */
function useCanvasScale(): { dpr: number; maxWidth: number } {
  const lite = useLite()
  return lite ? { dpr: 1, maxWidth: LITE_CANVAS_WIDTH } : { dpr: window.devicePixelRatio || 1, maxWidth: MAX_CANVAS_WIDTH }
}
const NAME_HEIGHT = 16

interface WaveformProps {
  assetId: string
  offset: number
  duration: number
  /** Seconds of audio per second of timeline (synced clips). */
  rate: number
  /** Drawn mirrored: the window's end at the left. */
  reversed: boolean
  gain: number
  width: number
  height: number
  color: string
}

function Waveform({ assetId, offset, duration, rate, reversed, gain, width, height, color }: WaveformProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = usePeaks(assetId)
  const { dpr, maxWidth } = useCanvasScale()

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width < 1 || height < 1) return
    const w = Math.max(1, Math.round(Math.min(width, maxWidth) * dpr))
    const h = Math.max(1, Math.round(height * dpr))
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, w, h)
    if (!peaks) return
    g.fillStyle = color
    const mid = h / 2
    const scale = Math.min(gain, MAX_CLIP_GAIN) * mid * 0.95
    const secondsPerPx = (duration * rate) / w
    for (let x = 0; x < w; x++) {
      const t0 = reversed ? offset + duration * rate - (x + 1) * secondsPerPx : offset + x * secondsPerPx
      const [lo, hi] = peakRange(peaks, t0, t0 + secondsPerPx)
      const top = mid - Math.min(1, hi) * scale
      const bottom = mid - Math.max(-1, lo) * scale
      g.fillRect(x, top, 1, Math.max(1, bottom - top))
    }
  }, [peaks, offset, duration, rate, reversed, gain, width, height, color, dpr, maxWidth])

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />
}

/**
 * The shaded area above a fade line: the fade runs from the clip edge at `edge` over `length`
 * pixels (negative for a fade-out, which runs leftwards from the right edge).
 */
function fadePolygon(edge: number, length: number, height: number, curve = 0): string {
  const steps = curve ? 16 : 1
  const points = [`${edge},0`, `${edge + length},0`]
  for (let i = steps; i >= 0; i--) points.push(`${edge + (length * i) / steps},${height * (1 - fadeShape(i / steps, curve))}`)
  return points.join(' ')
}

interface MidiNotesProps {
  notes: Note[]
  /** Seconds trimmed off the head of the clip's content. */
  offset: number
  duration: number
  width: number
  height: number
  color: string
  /** Drum clips: one row per pad note, top to bottom, instead of a pitch range. */
  rows?: number[]
}

/** Miniature of a note clip: pitches scaled to the clip's range, or one row per drum pad. */
function MidiNotes({ notes, offset, duration, width, height, color, rows }: MidiNotesProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const spb = beatSeconds(useProjectStore((s) => s.project.bpm))
  const { dpr, maxWidth } = useCanvasScale()

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width < 1 || height < 1) return
    const w = Math.max(1, Math.round(Math.min(width, maxWidth) * dpr))
    const h = Math.max(1, Math.round(height * dpr))
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, w, h)
    if (!notes.length) return
    const lo = Math.min(...notes.map((n) => n.pitch))
    const hi = Math.max(...notes.map((n) => n.pitch))
    // At least an octave tall, so a few notes don't fill the clip.
    const span = rows ? rows.length : Math.max(12, hi - lo + 1)
    const bottom = lo - Math.floor((span - (hi - lo + 1)) / 2)
    const row = h / (span + 1)
    const rowOf = (pitch: number) => (rows ? rows.indexOf(pitch) : -1)
    const pxPerSec = w / duration
    g.fillStyle = color
    for (const n of notes) {
      const x0 = (n.start * spb - offset) * pxPerSec
      const x1 = ((n.start + n.length) * spb - offset) * pxPerSec
      if (x1 <= 0 || x0 >= w) continue
      if (rows && rowOf(n.pitch) < 0) continue
      const y = rows ? (rowOf(n.pitch) + 0.5) * row : h - (n.pitch - bottom + 1) * row
      g.globalAlpha = 0.45 + 0.55 * n.velocity
      g.fillRect(Math.max(0, x0), y, Math.max(1, Math.min(w, x1) - Math.max(0, x0) - 1), Math.max(1, row - 1))
    }
  }, [notes, offset, duration, width, height, color, spb, rows, dpr, maxWidth])

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />
}

interface Props {
  clip: Clip
  color: string
  pps: number
  height: number
  selected: boolean
  onPointerDown: (e: React.PointerEvent, clip: Clip, handle: ClipHandle) => void
  onResetGain: (clip: Clip) => void
  /** Double-click on a fade handle: straighten that fade's curve. */
  onResetFadeCurve?: (clip: Clip, key: 'fadeInCurve' | 'fadeOutCurve') => void
  onOpen?: (clip: Clip) => void
  onMenu?: (e: React.MouseEvent, clip: Clip) => void
  /** Drum tracks: the pad notes, in row order. */
  noteRows?: number[]
}

export const ClipView = memo(function ClipView({
  clip,
  color,
  pps,
  height,
  selected,
  onPointerDown,
  onResetGain,
  onResetFadeCurve,
  onOpen,
  onMenu,
  noteRows,
}: Props) {
  const rate = clipRate(clip, useProjectStore((s) => s.project.bpm))
  const synced = !isMidiClip(clip) && clip.sourceBpm !== undefined
  const pitch = isMidiClip(clip) ? 0 : (clip.pitch ?? 0)
  const reversed = !isMidiClip(clip) && clip.reversed === true
  const width = Math.max(2, clip.duration * pps)
  const bodyHeight = height - 4
  const showName = height >= 48
  const waveTop = showName ? NAME_HEIGHT : 0
  const waveHeight = bodyHeight - waveTop
  const fadeInPx = clip.fadeIn * pps
  const fadeOutPx = clip.fadeOut * pps
  const gainY = waveTop + (1 - clip.gain / MAX_CLIP_GAIN) * waveHeight
  // While Alt is held over the clip, a line shows where a click would cut it.
  const [razorX, setRazorX] = useState<number | null>(null)
  const razorAt = (e: React.PointerEvent) => {
    if (!e.altKey || e.buttons) return setRazorX(null)
    const { project } = useProjectStore.getState()
    const t = clip.start + (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps
    const snapped = snapTime(t, project.snap, project.bpm, project.timeSignature)
    setRazorX(snapped > clip.start && snapped < clip.start + clip.duration ? (snapped - clip.start) * pps : null)
  }

  const handleDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as ClipHandle | undefined
    onPointerDown(e, clip, handle ?? 'body')
  }

  return (
    <div
      data-clip-id={clip.id}
      onPointerDown={handleDown}
      onPointerMove={razorAt}
      onPointerLeave={() => setRazorX(null)}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-handle]')) return
        onOpen?.(clip)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu?.(e, clip)
      }}
      className={`group absolute top-0.5 cursor-grab touch-none overflow-hidden rounded-md border select-none ${
        selected ? 'border-text ring-1 ring-text' : 'border-black/40'
      }`}
      style={{
        left: clip.start * pps,
        width,
        height: bodyHeight,
        background: `color-mix(in oklch, ${color} ${selected ? 32 : 22}%, var(--color-surface))`,
      }}
      title={`${clip.name} · gain ${formatGain(clip.gain)}${synced ? ` · synced from ${clip.sourceBpm} BPM` : ''}${
        pitch ? ` · pitch ${pitch > 0 ? '+' : ''}${pitch} semitones` : ''
      }${reversed ? ' · reversed' : ''}${
        isMidiClip(clip) ? ' · double-click to edit the notes' : ''
      } · Alt+click to cut · right-click for options`}
    >
      {showName && (
        <div className="pointer-events-none flex gap-1 px-1.5 text-[11px] leading-4 font-semibold" style={{ height: NAME_HEIGHT, color }}>
          <span className="truncate">{clip.name}</span>
          {synced && <span className="shrink-0 font-mono text-[10px] font-normal text-text-dim">♩{clip.sourceBpm}</span>}
          {pitch !== 0 && (
            <span className="shrink-0 font-mono text-[10px] font-normal text-text-dim">
              {pitch > 0 ? '+' : ''}
              {pitch}st
            </span>
          )}
          {reversed && (
            <span className="shrink-0 text-[10px] font-normal text-text-dim" aria-label="Reversed">
              ◀
            </span>
          )}
        </div>
      )}
      <div className="absolute inset-x-0" style={{ top: waveTop, height: waveHeight }}>
        {isMidiClip(clip) ? (
          <MidiNotes
            notes={clip.notes}
            offset={clip.offset}
            duration={clip.duration}
            width={width}
            height={waveHeight}
            color={color}
            rows={noteRows}
          />
        ) : (
          <Waveform
            assetId={clip.assetId}
            offset={clip.offset}
            duration={clip.duration}
            rate={rate}
            reversed={reversed}
            gain={clip.gain}
            width={width}
            height={waveHeight}
            color={color}
          />
        )}
      </div>

      {/* Fade shapes: shade the area above each fade line. */}
      <svg className="pointer-events-none absolute inset-0" width={width} height={bodyHeight}>
        {fadeInPx > 0 && <polygon points={fadePolygon(0, fadeInPx, bodyHeight, clip.fadeInCurve)} fill="rgb(0 0 0 / 0.45)" />}
        {fadeOutPx > 0 && <polygon points={fadePolygon(width, -fadeOutPx, bodyHeight, clip.fadeOutCurve)} fill="rgb(0 0 0 / 0.45)" />}
      </svg>

      {/* Gain line: drag up/down, double-click to reset to 0 dB. */}
      <div
        data-handle="gain"
        onDoubleClick={() => onResetGain(clip)}
        className="absolute inset-x-2 h-2 -translate-y-1/2 cursor-ns-resize opacity-0 group-hover:opacity-100"
        style={{ top: gainY }}
        title={`Clip gain ${formatGain(clip.gain)} · double-click to reset`}
      >
        <div className="mt-[3px] h-px bg-text/80" />
      </div>

      {/* Trim edges. */}
      <div data-handle="trim-start" className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-text/30" />
      <div data-handle="trim-end" className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-text/30" />

      {razorX !== null && <div className="pointer-events-none absolute inset-y-0 w-px bg-danger" style={{ left: razorX }} />}

      {/* Fade handles at the top corners. */}
      <div
        data-handle="fade-in"
        className="absolute top-0 size-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm border border-black/50 bg-text opacity-0 group-hover:opacity-100"
        style={{ left: Math.max(5, fadeInPx) }}
        onDoubleClick={() => onResetFadeCurve?.(clip, 'fadeInCurve')}
        title="Drag sideways to fade in, up or down to bend it · double-click to straighten"
      />
      <div
        data-handle="fade-out"
        className="absolute top-0 size-2.5 translate-x-1/2 cursor-ew-resize rounded-sm border border-black/50 bg-text opacity-0 group-hover:opacity-100"
        style={{ right: Math.max(5, fadeOutPx) }}
        onDoubleClick={() => onResetFadeCurve?.(clip, 'fadeOutCurve')}
        title="Drag sideways to fade out, up or down to bend it · double-click to straighten"
      />
    </div>
  )
})
