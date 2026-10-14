import { memo } from 'react'
import type { Track } from '../model/types'
import { removeTrack, renameTrack, setTrackPan, setTrackVolume, toggleMute, toggleSolo } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { HEADER_WIDTH } from './geometry'

interface Props {
  track: Track
  color: string
  compact: boolean
  height: number
}

export const TrackHeader = memo(function TrackHeader({ track, color, compact, height }: Props) {
  const endGesture = useProjectStore((s) => s.endGesture)
  const small = 'rounded border border-line px-1.5 py-0.5 text-[11px] leading-none hover:bg-surface-2'

  const slider = (label: string, value: number, min: number, max: number, onChange: (v: number) => void, text: string, reset: number) => (
    <label className="grid grid-cols-[2rem_1fr_2.75rem] items-center gap-2 text-[10px] text-text-dim">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onDoubleClick={() => onChange(reset)}
        aria-label={`${track.name} ${label.toLowerCase()}`}
      />
      <span className="text-right font-mono">{text}</span>
    </label>
  )

  return (
    <div
      className="sticky left-0 z-30 flex shrink-0 flex-col justify-center gap-1.5 border-r border-b border-line bg-surface px-3"
      style={{ width: HEADER_WIDTH, height, boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div className="flex items-center gap-1.5">
        <input
          defaultValue={track.name}
          key={track.name}
          onBlur={(e) => e.target.value !== track.name && renameTrack(track.id, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Track name"
          className="min-w-0 flex-1 truncate rounded bg-transparent px-1 text-sm font-semibold hover:bg-surface-2 focus:bg-bg"
        />
        <button
          onClick={() => toggleMute(track.id)}
          className={`${small} ${track.muted ? 'bg-warn text-accent-ink' : ''}`}
          aria-pressed={track.muted}
          title="Mute"
        >
          M
        </button>
        <button
          onClick={() => toggleSolo(track.id)}
          className={`${small} ${track.solo ? 'bg-accent text-accent-ink' : ''}`}
          aria-pressed={track.solo}
          title="Solo"
        >
          S
        </button>
        <button onClick={() => removeTrack(track.id)} className={`${small} hover:text-danger`} title="Delete track">
          ✕
        </button>
      </div>
      {slider('VOL', track.volume, 0, 1.5, (v) => setTrackVolume(track.id, v), `${Math.round(track.volume * 100)}%`, 1)}
      {!compact &&
        slider(
          'PAN',
          track.pan,
          -1,
          1,
          (v) => setTrackPan(track.id, v),
          track.pan === 0 ? 'C' : `${track.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan) * 100)}`,
          0,
        )}
    </div>
  )
})
