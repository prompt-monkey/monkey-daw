import { memo } from 'react'
import { faderToGain, formatDb, gainToFader } from '../model/levels'
import { useAutomatedValue } from '../automation/useAutomatedValue'
import { EFFECTS } from '../effects/definitions'
import type { Bus, Effect, Id, Track } from '../model/types'
import {
  removeBus,
  renameBus,
  setMasterVolume,
  setPan,
  setSend,
  setTrackOutput,
  setVolume,
  toggleMasterMute,
  toggleMute,
  toggleSolo,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { LevelMeter } from './LevelMeter'
import { VuMeter } from './VuMeter'

const small = 'rounded border border-line px-1.5 py-0.5 text-[11px] leading-none hover:bg-surface-2'

/** Badge shown on controls that automation is driving. */
const AutoBadge = () => (
  <span className="ml-0.5 font-bold text-accent" title="Automated">
    A
  </span>
)

const AUTOMATED_TITLE = 'Automated: edit the lane on the timeline'

function Fader({
  label,
  gain,
  onChange,
  automated = false,
}: {
  label: string
  gain: number
  onChange: (gain: number) => void
  automated?: boolean
}) {
  const endGesture = useProjectStore((s) => s.endGesture)
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.001}
      value={gainToFader(gain)}
      disabled={automated}
      onChange={(e) => onChange(faderToGain(Number(e.target.value)))}
      onPointerUp={endGesture}
      onKeyUp={endGesture}
      onDoubleClick={() => !automated && onChange(1)}
      aria-label={`${label} volume`}
      title={automated ? AUTOMATED_TITLE : 'Double-click for 0 dB'}
      className={`h-full w-6 ${automated ? 'cursor-default' : 'cursor-pointer'}`}
      style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
    />
  )
}

function PanSlider({
  label,
  pan,
  onChange,
  automated = false,
}: {
  label: string
  pan: number
  onChange: (pan: number) => void
  automated?: boolean
}) {
  const endGesture = useProjectStore((s) => s.endGesture)
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-text-dim">
      <span className="flex justify-between">
        <span>
          PAN
          {automated && <AutoBadge />}
        </span>
        <span className="font-mono">{Math.abs(pan) < 0.005 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`}</span>
      </span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={pan}
        disabled={automated}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onDoubleClick={() => !automated && onChange(0)}
        aria-label={`${label} pan`}
        title={automated ? AUTOMATED_TITLE : 'Double-click to center'}
      />
    </label>
  )
}

/** Opens the channel's effect rack; shows how many effects are active. */
function FxButton({ channel, effects, bypassed }: { channel: Id | 'master'; effects: Effect[]; bypassed: boolean }) {
  const openRack = useViewStore((s) => s.openRack)
  const active = bypassed ? 0 : effects.filter((e) => e.enabled).length
  return (
    <button
      onClick={() => openRack(channel)}
      className={`${small} ${active ? 'border-accent text-accent' : ''}`}
      title={
        effects.length
          ? `Effects: ${effects.map((e) => EFFECTS[e.type].name).join(', ')}${bypassed ? ' (bypassed)' : ''}`
          : 'Add effects'
      }
    >
      FX{active ? ` ${active}` : ''}
    </button>
  )
}

function StripFrame({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <div
      className="flex h-full w-28 shrink-0 flex-col gap-2 border-r border-line bg-surface px-2 py-2"
      style={color ? { boxShadow: `inset 0 3px 0 ${color}` } : undefined}
    >
      {children}
    </div>
  )
}

function FaderSection({
  channelId,
  label,
  gain,
  onChange,
  automated = false,
}: {
  channelId: Id | 'master'
  label: string
  gain: number
  onChange: (g: number) => void
  automated?: boolean
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 justify-center gap-2">
        <Fader label={label} gain={gain} onChange={onChange} automated={automated} />
        <LevelMeter channelId={channelId} className="h-full w-2.5" />
      </div>
      <div className="text-center font-mono text-[11px] text-text-dim">
        {formatDb(gain)} dB
        {automated && <AutoBadge />}
      </div>
    </>
  )
}

export const TrackStrip = memo(function TrackStrip({ track, color, buses }: { track: Track; color: string; buses: Bus[] }) {
  const endGesture = useProjectStore((s) => s.endGesture)
  // While automated, the fader and pan follow the automation and can't be moved by hand.
  const autoVolume = useAutomatedValue(track, 'volume')
  const autoPan = useAutomatedValue(track, 'pan')
  return (
    <StripFrame color={color}>
      <div className="truncate text-xs font-semibold" title={track.name}>
        {track.name}
      </div>
      <label className="flex items-center gap-1 text-[10px] text-text-dim">
        OUT
        <select
          value={track.output}
          onChange={(e) => setTrackOutput(track.id, e.target.value)}
          className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-text"
          aria-label={`${track.name} output`}
        >
          <option value="master">Master</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {buses.length > 0 && (
        <div className="flex max-h-20 flex-col gap-1 overflow-y-auto" aria-label="Sends">
          {buses.map((bus) => {
            const level = track.sends.find((s) => s.busId === bus.id)?.level ?? 0
            return (
              <label key={bus.id} className="grid grid-cols-[1fr_auto] items-center gap-x-1 text-[10px] text-text-dim">
                <span className="truncate">→ {bus.name}</span>
                <span className="font-mono">{level ? formatDb(level) : 'off'}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={gainToFader(level)}
                  onChange={(e) => setSend(track.id, bus.id, faderToGain(Number(e.target.value)))}
                  onPointerUp={endGesture}
                  onKeyUp={endGesture}
                  onDoubleClick={() => setSend(track.id, bus.id, level ? 0 : 1)}
                  aria-label={`${track.name} send to ${bus.name}`}
                  title="Post-fader send · double-click to toggle 0 dB / off"
                  className="col-span-2"
                />
              </label>
            )
          })}
        </div>
      )}
      <PanSlider
        label={track.name}
        pan={autoPan === null ? track.pan : autoPan * 2 - 1}
        onChange={(v) => setPan(track.id, v)}
        automated={autoPan !== null}
      />
      <FaderSection
        channelId={track.id}
        label={track.name}
        gain={autoVolume === null ? track.volume : faderToGain(autoVolume)}
        onChange={(g) => setVolume(track.id, g)}
        automated={autoVolume !== null}
      />
      <div className="flex justify-center gap-1">
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
        <FxButton channel={track.id} effects={track.effects} bypassed={track.fxBypass} />
      </div>
    </StripFrame>
  )
})

export const BusStrip = memo(function BusStrip({ bus, sources }: { bus: Bus; sources: string[] }) {
  return (
    <StripFrame color="var(--color-text-dim)">
      <div className="flex items-center gap-1">
        <input
          defaultValue={bus.name}
          key={bus.name}
          onBlur={(e) => e.target.value !== bus.name && renameBus(bus.id, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Bus name"
          className="min-w-0 flex-1 truncate rounded bg-transparent px-0.5 text-xs font-semibold hover:bg-surface-2 focus:bg-bg"
        />
        <button onClick={() => removeBus(bus.id)} className={`${small} hover:text-danger`} title="Delete bus">
          ✕
        </button>
      </div>
      <div className="line-clamp-3 text-[10px] text-text-dim" title={sources.join(', ')}>
        {sources.length ? `From: ${sources.join(', ')}` : 'No tracks feed this bus yet'}
      </div>
      <PanSlider label={bus.name} pan={bus.pan} onChange={(v) => setPan(bus.id, v)} />
      <FaderSection channelId={bus.id} label={bus.name} gain={bus.volume} onChange={(g) => setVolume(bus.id, g)} />
      <div className="flex justify-center gap-1">
        <button
          onClick={() => toggleMute(bus.id)}
          className={`${small} ${bus.muted ? 'bg-warn text-accent-ink' : ''}`}
          aria-pressed={bus.muted}
          title="Mute"
        >
          M
        </button>
        <FxButton channel={bus.id} effects={bus.effects} bypassed={bus.fxBypass} />
      </div>
    </StripFrame>
  )
})

export function MasterStrip() {
  const master = useProjectStore((s) => s.project.master)
  return (
    <div className="flex h-full w-40 shrink-0 flex-col gap-2 border-l border-line bg-surface px-3 py-2">
      <div className="text-xs font-semibold">Master</div>
      <VuMeter className="h-16 w-full rounded-md border border-line bg-bg" />
      <FaderSection channelId="master" label="Master" gain={master.volume} onChange={setMasterVolume} />
      <div className="flex justify-center gap-1">
        <button
          onClick={toggleMasterMute}
          className={`${small} ${master.muted ? 'bg-warn text-accent-ink' : ''}`}
          aria-pressed={master.muted}
          title="Mute master"
        >
          M
        </button>
        <FxButton channel="master" effects={master.effects} bypassed={master.fxBypass} />
      </div>
    </div>
  )
}
