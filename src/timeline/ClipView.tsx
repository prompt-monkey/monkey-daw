import { memo, useEffect, useRef } from 'react'
import { peakRange } from '../audio/peaks'
import { usePeaks } from '../audio/peaksCache'
import type { Clip } from '../model/types'
import { MAX_CLIP_GAIN, formatGain } from './edits'

export type ClipHandle = 'body' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out' | 'gain'

/** Backing-store width cap; wider clips stretch the waveform image. */
const MAX_CANVAS_WIDTH = 4096
const NAME_HEIGHT = 16

interface WaveformProps {
  assetId: string
  offset: number
  duration: number
  gain: number
  width: number
  height: number
  color: string
}

function Waveform({ assetId, offset, duration, gain, width, height, color }: WaveformProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const peaks = usePeaks(assetId)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || width < 1 || height < 1) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(Math.min(width, MAX_CANVAS_WIDTH) * dpr))
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
    const secondsPerPx = duration / w
    for (let x = 0; x < w; x++) {
      const t0 = offset + x * secondsPerPx
      const [lo, hi] = peakRange(peaks, t0, t0 + secondsPerPx)
      const top = mid - Math.min(1, hi) * scale
      const bottom = mid - Math.max(-1, lo) * scale
      g.fillRect(x, top, 1, Math.max(1, bottom - top))
    }
  }, [peaks, offset, duration, gain, width, height, color])

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
}

export const ClipView = memo(function ClipView({ clip, color, pps, height, selected, onPointerDown, onResetGain }: Props) {
  const width = Math.max(2, clip.duration * pps)
  const bodyHeight = height - 4
  const showName = height >= 48
  const waveTop = showName ? NAME_HEIGHT : 0
  const waveHeight = bodyHeight - waveTop
  const fadeInPx = clip.fadeIn * pps
  const fadeOutPx = clip.fadeOut * pps
  const gainY = waveTop + (1 - clip.gain / MAX_CLIP_GAIN) * waveHeight

  const handleDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as ClipHandle | undefined
    onPointerDown(e, clip, handle ?? 'body')
  }

  return (
    <div
      data-clip-id={clip.id}
      onPointerDown={handleDown}
      className={`group absolute top-0.5 cursor-grab overflow-hidden rounded-md border select-none ${
        selected ? 'border-text ring-1 ring-text' : 'border-black/40'
      }`}
      style={{
        left: clip.start * pps,
        width,
        height: bodyHeight,
        background: `color-mix(in oklch, ${color} ${selected ? 32 : 22}%, var(--color-surface))`,
      }}
      title={`${clip.name} · gain ${formatGain(clip.gain)}`}
    >
      {showName && (
        <div className="pointer-events-none truncate px-1.5 text-[11px] leading-4 font-semibold" style={{ height: NAME_HEIGHT, color }}>
          {clip.name}
        </div>
      )}
      <div className="absolute inset-x-0" style={{ top: waveTop, height: waveHeight }}>
        <Waveform
          assetId={clip.assetId}
          offset={clip.offset}
          duration={clip.duration}
          gain={clip.gain}
          width={width}
          height={waveHeight}
          color={color}
        />
      </div>

      {/* Fade shapes: shade the area above each fade line. */}
      <svg className="pointer-events-none absolute inset-0" width={width} height={bodyHeight}>
        {fadeInPx > 0 && <polygon points={`0,0 ${fadeInPx},0 0,${bodyHeight}`} fill="rgb(0 0 0 / 0.45)" />}
        {fadeOutPx > 0 && <polygon points={`${width},0 ${width - fadeOutPx},0 ${width},${bodyHeight}`} fill="rgb(0 0 0 / 0.45)" />}
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

      {/* Fade handles at the top corners. */}
      <div
        data-handle="fade-in"
        className="absolute top-0 size-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm border border-black/50 bg-text opacity-0 group-hover:opacity-100"
        style={{ left: Math.max(5, fadeInPx) }}
        title="Drag to fade in"
      />
      <div
        data-handle="fade-out"
        className="absolute top-0 size-2.5 translate-x-1/2 cursor-ew-resize rounded-sm border border-black/50 bg-text opacity-0 group-hover:opacity-100"
        style={{ right: Math.max(5, fadeOutPx) }}
        title="Drag to fade out"
      />
    </div>
  )
})
