import { memo } from 'react'
import { faderToGain, formatDb, gainToFader } from '../model/levels'
import type { Track } from '../model/types'
import { LevelMeter } from '../mixer/LevelMeter'
import {
  addTrack,
  duplicateTrack,
  removeTrack,
  renameTrack,
  setPan,
  setVolume,
  toggleMute,
  toggleSolo,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { Menu } from '../ui/Menu'
import { HEADER_WIDTH } from './geometry'

interface Props {
  track: Track
  index: number
  color: string
  compact: boolean
  height: number
  onGripDown: (e: React.PointerEvent, trackId: string) => void
}

export const TrackHeader = memo(function TrackHeader({ track, index, color, compact, height, onGripDown }: Props) {
  const endGesture = useProjectStore((s) => s.endGesture)
  const small = 'rounded border border-line px-1.5 py-0.5 text-[11px] leading-none hover:bg-surface-2'

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
    text: string,
    reset: number,
  ) => (
    <label className="grid grid-cols-[2rem_1fr_2.75rem] items-center gap-2 text-[10px] text-text-dim">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={0.001}
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
      className="sticky left-0 z-30 flex shrink-0 border-r border-b border-line bg-surface"
      style={{ width: HEADER_WIDTH, height, boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div
        onPointerDown={(e) => onGripDown(e, track.id)}
        className="flex w-4 shrink-0 cursor-grab items-center justify-center text-text-dim/60 hover:text-text"
        title="Drag to reorder"
      >
        ⠿
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-1 pr-2">
        <div className="flex items-center gap-1">
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
          <Menu
            label="Track options"
            className={small}
            items={[
              { label: 'Insert track above', onSelect: () => addTrack(index) },
              { label: 'Insert track below', onSelect: () => addTrack(index + 1) },
              { label: 'Duplicate track', onSelect: () => duplicateTrack(track.id) },
              { label: 'Delete track', onSelect: () => removeTrack(track.id), danger: true },
            ]}
          >
            ⋮
          </Menu>
        </div>
        {slider(
          'VOL',
          gainToFader(track.volume),
          0,
          1,
          (v) => setVolume(track.id, faderToGain(v)),
          formatDb(track.volume),
          gainToFader(1),
        )}
        {!compact &&
          slider(
            'PAN',
            track.pan,
            -1,
            1,
            (v) => setPan(track.id, v),
            track.pan === 0 ? 'C' : `${track.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan) * 100)}`,
            0,
          )}
      </div>
      <LevelMeter channelId={track.id} className="my-2 mr-2 w-1.5 shrink-0" />
    </div>
  )
})
