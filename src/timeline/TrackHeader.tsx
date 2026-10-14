import { memo } from 'react'
import { faderToGain, formatDb, gainToFader } from '../model/levels'
import type { Track } from '../model/types'
import { LevelMeter } from '../mixer/LevelMeter'
import { INSTRUMENT_LABELS } from '../audio/instruments'
import { presetName } from '../drums/kits'
import { secondsPerBar } from '../model/grid'
import { useTransportStore } from '../state/transport'
import {
  addMidiClip,
  addTrack,
  duplicateTrack,
  removeAutomationLane,
  removeTrack,
  renameTrack,
  setPan,
  setVolume,
  toggleMute,
  toggleSolo,
} from '../state/actions'
import { readInputMeter, toggleArm } from '../recording/session'
import { useRecordingStore } from '../recording/store'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { Menu } from '../ui/Menu'
import { useAutomatedValue } from '../automation/useAutomatedValue'
import { availableTargets } from '../automation/targets'
import { useHeaderWidth, useShellStore } from '../ui/shell'

const formatPan = (pan: number) => (Math.abs(pan) < 0.005 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`)

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
  const armed = useRecordingStore((s) => s.armedTrackId === track.id)
  const laneTarget = useViewStore((s) => s.automationView[track.id])
  const setAutomationView = useViewStore((s) => s.setAutomationView)
  // While automated, the sliders follow the automation and can't be dragged.
  const autoVolume = useAutomatedValue(track, 'volume')
  const autoPan = useAutomatedValue(track, 'pan')
  // Phones: a narrower header, name and buttons on separate rows, volume and pan in the mixer.
  const narrow = useShellStore((s) => s.narrow)
  const headerWidth = useHeaderWidth()
  const small = 'rounded border border-line px-1.5 py-0.5 text-[11px] leading-none hover:bg-surface-2'

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
    text: string,
    reset: number,
    automated: boolean,
  ) => (
    <label className="grid grid-cols-[2rem_1fr_2.75rem] items-center gap-2 text-[10px] text-text-dim">
      <span>
        {label}
        {automated && <span className="ml-0.5 font-bold text-accent" title="Automated">A</span>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.001}
        value={value}
        disabled={automated}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onDoubleClick={() => onChange(reset)}
        aria-label={`${track.name} ${label.toLowerCase()}`}
        title={automated ? 'Automated: edit the lane on the timeline' : undefined}
      />
      <span className="text-right font-mono">{text}</span>
    </label>
  )

  /** Opens the clip under the playhead (or the first clip) in the piano roll, adding one if there is none. */
  const editNotes = () => {
    const view = useViewStore.getState()
    const at = useTransportStore.getState().cursor
    const clip = track.clips.find((c) => c.start <= at && c.start + c.duration > at) ?? track.clips[0]
    if (clip) {
      view.openPianoRoll(track.id, clip.id)
      return
    }
    const { project } = useProjectStore.getState()
    const bar = secondsPerBar(project.bpm, project.timeSignature)
    const id = addMidiClip(track.id, Math.floor(at / bar) * bar)
    if (id) view.openPianoRoll(track.id, id)
  }

  const newClipAtPlayhead = () => {
    const { project } = useProjectStore.getState()
    const bar = secondsPerBar(project.bpm, project.timeSignature)
    const id = addMidiClip(track.id, Math.floor(useTransportStore.getState().cursor / bar) * bar)
    if (id) useViewStore.getState().openPianoRoll(track.id, id)
  }

  const showAutomation = () => {
    const withPoints = track.automation.find((l) => l.points.length > 0)
    setAutomationView(track.id, withPoints?.target ?? 'volume')
  }

  const laneRow = laneTarget && (
    <div className="flex items-center gap-1 text-[10px] text-text-dim">
      <select
        value={laneTarget}
        onChange={(e) => setAutomationView(track.id, e.target.value)}
        aria-label={`${track.name} automation lane`}
        className="min-w-0 flex-1 rounded border border-accent/60 bg-bg px-1 py-0.5 text-[11px] text-text"
      >
        {availableTargets(track).map((t) => (
          <option key={t.target} value={t.target}>
            {track.automation.some((l) => l.target === t.target && l.points.length) ? '● ' : ''}
            {t.label}
          </option>
        ))}
      </select>
      <button
        className={small}
        onClick={() => removeAutomationLane(track.id, laneTarget)}
        disabled={!track.automation.some((l) => l.target === laneTarget && l.points.length)}
        title="Delete this lane's points"
      >
        Clear
      </button>
      <button className={small} onClick={() => setAutomationView(track.id, null)} title="Back to the clips" aria-label="Hide automation">
        ✕
      </button>
    </div>
  )

  return (
    <div
      className="sticky left-0 z-30 flex shrink-0 border-r border-b border-line bg-surface"
      style={{ width: headerWidth, height, boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div
        onPointerDown={(e) => onGripDown(e, track.id)}
        className="flex w-4 shrink-0 cursor-grab items-center justify-center text-text-dim/60 hover:text-text"
        title="Drag to reorder"
      >
        ⠿
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-1 pr-2">
        <div className={`flex items-center gap-1 ${narrow ? 'flex-wrap' : ''}`}>
          <input
            defaultValue={track.name}
            key={track.name}
            onBlur={(e) => e.target.value !== track.name && renameTrack(track.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Track name"
            className={`min-w-0 flex-1 truncate rounded bg-transparent px-1 text-sm font-semibold hover:bg-surface-2 focus:bg-bg ${narrow ? 'basis-full' : ''}`}
          />
          {track.kind !== 'audio' ? (
            <button
              onClick={editNotes}
              className={`${small} max-w-16 truncate text-accent`}
              title={track.kit ? 'Edit the beat in the drum editor' : 'Edit the notes in the piano roll'}
            >
              {track.kit ? `▦ ${presetName(track.kit.preset)}` : `♪ ${track.instrument ? INSTRUMENT_LABELS[track.instrument.type] : ''}`}
            </button>
          ) : (
            <button
              onClick={() => void toggleArm(track.id)}
              className={`${small} ${armed ? 'border-danger bg-danger text-white' : 'text-danger'}`}
              aria-pressed={armed}
              title={armed ? 'Disarm (stop listening to the input)' : 'Arm this track for recording'}
            >
              ●
            </button>
          )}
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
              { label: 'Insert MIDI track below', onSelect: () => addTrack(index + 1, 'midi') },
              { label: 'Insert drum track below', onSelect: () => addTrack(index + 1, 'drums') },
              ...(track.kind !== 'audio'
                ? [
                    { label: track.kit ? 'Edit beat…' : 'Edit notes…', onSelect: editNotes },
                    { label: `New ${track.kit ? 'drum' : 'MIDI'} clip at playhead`, onSelect: newClipAtPlayhead },
                  ]
                : []),
              { label: 'Effects…', onSelect: () => useViewStore.getState().openRack(track.id) },
              laneTarget
                ? { label: 'Hide automation', onSelect: () => setAutomationView(track.id, null) }
                : { label: 'Show automation', onSelect: showAutomation },
              { label: 'Automate volume', onSelect: () => setAutomationView(track.id, 'volume') },
              { label: 'Automate pan', onSelect: () => setAutomationView(track.id, 'pan') },
              { label: 'Duplicate track', onSelect: () => duplicateTrack(track.id) },
              { label: 'Delete track', onSelect: () => removeTrack(track.id), danger: true },
            ]}
          >
            ⋮
          </Menu>
        </div>
        {!narrow &&
          (!compact || !laneTarget) &&
          slider(
            'VOL',
            autoVolume ?? gainToFader(track.volume),
            0,
            1,
            (v) => setVolume(track.id, faderToGain(v)),
            formatDb(autoVolume === null ? track.volume : faderToGain(autoVolume)),
            gainToFader(1),
            autoVolume !== null,
          )}
        {!narrow &&
          !compact &&
          !laneTarget &&
          slider(
            'PAN',
            autoPan === null ? track.pan : autoPan * 2 - 1,
            -1,
            1,
            (v) => setPan(track.id, v),
            formatPan(autoPan === null ? track.pan : autoPan * 2 - 1),
            0,
            autoPan !== null,
          )}
        {laneRow}
      </div>
      {/* While armed, the meter shows the input level so you can set it before recording. */}
      <LevelMeter
        channelId={track.id}
        read={armed ? readInputMeter : undefined}
        className="my-2 mr-2 w-1.5 shrink-0"
      />
    </div>
  )
})
