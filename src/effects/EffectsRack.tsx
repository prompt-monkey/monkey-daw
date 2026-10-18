import { memo, useMemo, useRef, useState } from 'react'
import type { Effect, EffectType, Id } from '../model/types'
import {
  addAutomationLane,
  addEffect,
  applyChain,
  moveEffect,
  removeEffect,
  setEffectParam,
  toggleChainBypass,
  toggleEffect,
  type ChannelRef,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { Knob } from '../ui/Knob'
import { Menu } from '../ui/Menu'
import { toast } from '../ui/toast'
import { effectTarget } from '../automation/targets'
import { useAutomatedValue } from '../automation/useAutomatedValue'
import { Dialog } from '../ui/Dialog'
import { EFFECTS, EFFECT_TYPES, automatableParams, formatValue, fromNormalized, syncedValue, type ChoiceParam, type NumberParam } from './definitions'
import { effectViz, vizPath } from './viz'
import { BUILT_IN_PRESETS, deleteUserPreset, saveUserPreset, useUserPresets } from './presets'
import { engine } from '../audio/engine'
import { noteName } from '../model/midi'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import type { TunerReading } from './specialist'
import { Icon } from '../ui/Icon'

/** Auto-tune's live readout: the note being sung, how far off it is, and where it's going. */
function TunerReadout({ channel, effectId }: { channel: ChannelRef; effectId: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  usePlayheadFrame(() => {
    const el = ref.current
    if (!el) return
    const r = engine.effectMonitor(channel, effectId) as TunerReading | null
    if (!r) {
      el.textContent = 'Listening…'
      el.title = 'Shows the sung note while audio plays'
      return
    }
    const cents = Math.round((r.midi - Math.round(r.midi)) * 100)
    const text = `${noteName(Math.round(r.midi))} ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢ → ${noteName(r.target)}`
    if (el.textContent !== text) el.textContent = text
    el.title = 'Heard note, how far off it is, and the note it is pulled to'
  })
  return <span ref={ref} className="font-mono text-[11px] text-accent" aria-live="off" />
}

/** Drag-and-drop data type carrying the id of an effect being reordered. */
const EFFECT_DRAG_TYPE = 'application/x-monkey-daw-effect'

const small = 'btn btn-sm h-6 px-2'

/** Adds a lane for an effect parameter and shows it, saying where it is drawn. */
function automateParam(channel: ChannelRef, effect: Effect, def: NumberParam) {
  if (def.automatable === false) {
    toast(`${def.label} can't be automated: changing it rebuilds the sound.`)
    return
  }
  const target = effectTarget(effect.id, def.key)
  addAutomationLane(channel, target)
  useViewStore.getState().setAutomationView(channel, target)
  // Track lanes are drawn over the track; bus and master lanes get a row under the tracks.
  const { tracks, buses } = useProjectStore.getState().project
  const track = tracks.find((t) => t.id === channel)
  const bus = buses.find((b) => b.id === channel)
  const where = track ? `"${track.name}"` : `the ${bus ? `"${bus.name}"` : 'master'} row under the tracks`
  toast(`Automating ${def.label} on ${where}: click the lane on the timeline to add points.`)
}

/**
 * A parameter knob that knows about automation: right-click automates it on the track's
 * timeline; when automated it follows the lane during playback and shows an "A" badge.
 */
function ParamKnob({
  channel,
  effect,
  def,
  onChange,
  onCommit,
  disabled,
  display,
}: {
  channel: ChannelRef
  effect: Effect
  def: NumberParam
  onChange: (value: number) => void
  onCommit: () => void
  disabled: boolean
  display?: string
}) {
  const holder = useProjectStore((s) =>
    channel === 'master' ? s.project.master : (s.project.tracks.find((t) => t.id === channel) ?? s.project.buses.find((b) => b.id === channel)),
  )
  const target = effectTarget(effect.id, def.key)
  const automated = useAutomatedValue(holder, target)
  const writing = useViewStore((s) => s.automationWrite)

  return (
    <Knob
      def={def}
      value={automated === null ? (effect.params[def.key] as number) : fromNormalized(def, automated)}
      onChange={onChange}
      onCommit={onCommit}
      disabled={disabled}
      display={display}
      // Writing automation unlocks automated knobs so they can be moved while playing.
      automated={automated !== null && !writing}
      onContextMenu={(e) => {
        e.preventDefault()
        if (holder) automateParam(channel, effect, def)
      }}
    />
  )
}

const EffectCard = memo(function EffectCard({
  channel,
  effect,
  index,
  count,
  bpm,
  onInsert,
}: {
  channel: ChannelRef
  effect: Effect
  index: number
  count: number
  bpm: number
  /** Opens the effect picker to insert an effect at this chain position. */
  onInsert: (index: number) => void
}) {
  const endGesture = useProjectStore((s) => s.endGesture)
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null)
  const [dragging, setDragging] = useState(false)
  const def = EFFECTS[effect.type]
  const set = (key: string, value: number | string | boolean) => setEffectParam(channel, effect.id, key, value)
  // A tempo-synced number (delay time, tremolo rate) shows the note length's value instead.
  const synced = syncedValue(effect.type, effect.params, bpm)
  const sideAt = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
  }

  return (
    <article
      className={`relative flex shrink-0 flex-col gap-2 rounded-[14px] border border-transparent bg-surface p-2.5 shadow-ring ${
        effect.enabled ? '' : 'opacity-60'
      } ${dragging ? 'opacity-40' : ''}`}
      aria-label={`${def.name} effect`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropSide(sideAt(e))
      }}
      // Only clear the marker when the pointer leaves the card, not when it crosses a knob inside it.
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropSide(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(EFFECT_DRAG_TYPE)
        const side = sideAt(e)
        setDropSide(null)
        if (!id || id === effect.id) return
        e.preventDefault()
        const chain = useProjectStore.getState().project
        const list = channel === 'master' ? chain.master.effects : [...chain.tracks, ...chain.buses].find((c) => c.id === channel)?.effects ?? []
        const from = list.findIndex((x) => x.id === id)
        let to = index + (side === 'after' ? 1 : 0)
        if (from < to) to -= 1
        moveEffect(channel, id, to)
      }}
    >
      {dropSide && (
        <div className={`absolute inset-y-1 w-0.5 rounded bg-accent ${dropSide === 'before' ? '-left-1.5' : '-right-1.5'}`} />
      )}
      {/* The whole header is the drag handle; drags that start on its buttons are ignored. */}
      <header
        draggable
        onDragStart={(e) => {
          if ((e.target as HTMLElement).closest('button')) {
            e.preventDefault()
            return
          }
          e.dataTransfer.setData(EFFECT_DRAG_TYPE, effect.id)
          e.dataTransfer.effectAllowed = 'move'
          setDragging(true)
        }}
        onDragEnd={() => setDragging(false)}
        className="group/header -mx-1 flex cursor-grab items-center gap-1.5 rounded-md px-1 py-0.5 transition-[background-color] duration-150 ease-out hover:bg-surface-2 active:cursor-grabbing"
        title="Drag to reorder"
      >
        <span className="text-text-dim/50 group-hover/header:text-text" aria-hidden>
          <Icon name="grip" size={12} />
        </span>
        <button
          className={`size-3 shrink-0 rounded-full border transition-[background-color,border-color] duration-150 ease-out ${effect.enabled ? 'border-accent bg-accent' : 'border-line-strong bg-transparent'}`}
          onClick={() => toggleEffect(channel, effect.id)}
          aria-pressed={effect.enabled}
          aria-label={effect.enabled ? `Turn ${def.name} off` : `Turn ${def.name} on`}
          title={effect.enabled ? 'On · click to bypass' : 'Bypassed · click to turn on'}
        />
        <h3 className="flex-1 text-xs font-semibold" title={def.description}>
          {def.name}
        </h3>
        {automatableParams(effect.type).length > 0 && (
          <Menu
            label={`Automate a ${def.name} control`}
            className="btn btn-sm btn-icon btn-ghost"
            items={automatableParams(effect.type).map((p) => ({ label: `Automate ${p.label}`, onSelect: () => automateParam(channel, effect, p) }))}
          >
            <Icon name="automation" size={14} />
          </Menu>
        )}
        <Menu
          label={`${def.name} options`}
          className="btn btn-sm btn-icon btn-ghost"
          items={[
            ...(index > 0 ? [{ label: 'Move left', onSelect: () => moveEffect(channel, effect.id, index - 1) }] : []),
            ...(index < count - 1 ? [{ label: 'Move right', onSelect: () => moveEffect(channel, effect.id, index + 1) }] : []),
            { label: 'Insert effect before', onSelect: () => onInsert(index) },
            { label: 'Insert effect after', onSelect: () => onInsert(index + 1) },
            { label: 'Remove', onSelect: () => removeEffect(channel, effect.id), danger: true },
          ]}
        >
          <Icon name="more" size={14} />
        </Menu>
      </header>

      <EffectScreen effect={effect} bpm={bpm} />
      {effect.type === 'autotune' && <TunerReadout channel={channel} effectId={effect.id} />}
      <div className="grid auto-cols-max grid-flow-col grid-rows-2 gap-x-1 gap-y-2">
        {def.params.map((p) => {
          if (p.kind === 'number') {
            const isSynced = synced !== null && def.sync?.param === p.key
            return (
              <ParamKnob
                key={p.key}
                channel={channel}
                effect={effect}
                def={p as NumberParam}
                onChange={(v) => set(p.key, v)}
                onCommit={endGesture}
                disabled={isSynced}
                display={
                  isSynced ? (def.sync!.as === 'time' ? `${Math.round(synced! * 1000)} ms` : formatValue(p as NumberParam, synced!)) : undefined
                }
              />
            )
          }
          if (p.kind === 'choice') {
            return (
              <label key={p.key} className="flex w-20 flex-col items-center justify-center gap-1 text-[10px] text-text-dim">
                {p.label}
                <select
                  value={effect.params[p.key] as string}
                  onChange={(e) => set(p.key, e.target.value)}
                  className="field field-sm w-full"
                >
                  {(p as ChoiceParam).options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
          const on = effect.params[p.key] === true
          return (
            <div key={p.key} className="flex w-20 flex-col items-center justify-center gap-1 text-[10px] text-text-dim">
              {p.label}
              <button className={small} onClick={() => set(p.key, !on)} aria-pressed={on}>
                {on ? 'On' : 'Off'}
              </button>
            </div>
          )
        })}
      </div>
    </article>
  )
})

function PresetMenu({ channel, effects, channelName }: { channel: ChannelRef; effects: Effect[]; channelName: string }) {
  const userPresets = useUserPresets((s) => s.presets)
  const [saving, setSaving] = useState(false)

  if (saving) {
    return (
      <input
        autoFocus
        placeholder="Preset name"
        aria-label="Preset name"
        className="field field-sm h-6 w-40 px-2 text-xs"
        onBlur={() => setSaving(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSaving(false)
          if (e.key !== 'Enter') return
          const name = e.currentTarget.value.trim()
          if (name) {
            saveUserPreset(name, effects)
            toast(`Saved preset "${name}"`)
          }
          setSaving(false)
        }}
      />
    )
  }

  return (
    <Menu
      label="Chain presets"
      className={small}
      items={[
        ...BUILT_IN_PRESETS.map((p) => ({ label: p.name, onSelect: () => applyChain(channel, p.chain, `Preset: ${p.name}`) })),
        ...userPresets.map((p) => ({ label: `★ ${p.name}`, onSelect: () => applyChain(channel, p.chain, `Preset: ${p.name}`) })),
        ...(effects.length ? [{ label: 'Save this chain as a preset…', onSelect: () => setSaving(true) }] : []),
        ...userPresets.map((p) => ({ label: `Delete preset "${p.name}"`, onSelect: () => deleteUserPreset(p.name), danger: true })),
        ...(effects.length ? [{ label: `Clear ${channelName}'s chain`, onSelect: () => applyChain(channel, [], 'Clear effects'), danger: true }] : []),
      ]}
    >
      Presets
      <Icon name="chevronDown" size={12} />
    </Menu>
  )
}

const SCREEN_W = 160
const SCREEN_H = 36

/** The card's little screen: the effect's curve with its current settings. */
function EffectScreen({ effect, bpm }: { effect: Effect; bpm: number }) {
  const viz = useMemo(() => effectViz(effect, bpm), [effect, bpm])
  const path = vizPath(viz, SCREEN_W, SCREEN_H)
  return (
    <svg
      viewBox={`0 0 ${SCREEN_W} ${SCREEN_H}`}
      preserveAspectRatio="none"
      className={`h-9 w-full rounded-[3px] bg-bg ${effect.enabled ? 'text-accent' : 'text-text-dim'}`}
      aria-hidden
    >
      {viz.baseline !== undefined && (
        <line x1={0} x2={SCREEN_W} y1={viz.baseline * SCREEN_H} y2={viz.baseline * SCREEN_H} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="2 3" />
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={viz.bars ? 3 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** The effect chain of one channel: cards in signal order, left to right. */
const GROUPS = [
  { id: 'essentials', title: 'Essentials' },
  { id: 'character', title: 'Character and space' },
  { id: 'specialist', title: 'Specialist' },
  { id: 'creative', title: 'Creative' },
] as const

/** Every effect, by group, with what it does. */
function EffectPicker({ onPick, onClose }: { onPick: (type: EffectType) => void; onClose: () => void }) {
  return (
    <Dialog title="Add effect" onClose={onClose} wide>
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
        {GROUPS.map((group) => (
          <section key={group.id}>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-accent uppercase">{group.title}</h3>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EFFECT_TYPES.filter((t) => EFFECTS[t].group === group.id).map((type) => (
                <button
                  key={type}
                  onClick={() => onPick(type)}
                  className="flex flex-col items-start gap-0.5 rounded-md border border-transparent bg-surface-2 px-2.5 py-1.5 text-left shadow-ring transition-[background-color,box-shadow] duration-150 ease-out hover:bg-surface-3 hover:shadow-ring-hover"
                >
                  <span className="text-sm font-semibold">{EFFECTS[type].name}</span>
                  <span className="text-[11px] leading-snug text-text-dim">{EFFECTS[type].description}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

export function EffectsRack() {
  // Where the picked effect goes in the chain (null: the picker is closed).
  const [picking, setPicking] = useState<number | null>(null)
  const channel = useViewStore((s) => s.rackChannel)
  const openRack = useViewStore((s) => s.openRack)
  const tracks = useProjectStore((s) => s.project.tracks)
  const buses = useProjectStore((s) => s.project.buses)
  const master = useProjectStore((s) => s.project.master)
  const bpm = useProjectStore((s) => s.project.bpm)

  const holder: { name: string; effects: Effect[]; fxBypass: boolean } | undefined =
    channel === 'master'
      ? { name: 'Master', effects: master.effects, fxBypass: master.fxBypass }
      : [...tracks, ...buses].find((c) => c.id === channel)
  // The selected channel was deleted: fall back to the master.
  const ref: ChannelRef = holder ? channel : 'master'
  const chain = holder ?? { name: 'Master', effects: master.effects, fxBypass: master.fxBypass }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <label className="flex items-center gap-1.5 text-xs text-text-dim">
          Effects on
          <select
            value={ref}
            onChange={(e) => openRack(e.target.value as Id)}
            className="field field-sm h-6 text-xs"
            aria-label="Channel"
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (bus)
              </option>
            ))}
            <option value="master">Master</option>
          </select>
        </label>
        <button
          className={`${small} ${chain.fxBypass ? 'border-warn text-warn' : ''}`}
          onClick={() => toggleChainBypass(ref)}
          aria-pressed={chain.fxBypass}
          disabled={!chain.effects.length}
          title="Bypass the whole chain to compare with and without effects"
        >
          {chain.fxBypass ? 'Chain bypassed' : 'Bypass chain'}
        </button>
        <PresetMenu channel={ref} effects={chain.effects} channelName={chain.name} />
        <span className="flex-1" />
        <span className="text-[11px] text-text-dim">Signal flows left to right · drag an effect by its name to reorder</span>
      </div>

      <div className={`flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-3 ${chain.fxBypass ? 'opacity-50' : ''}`}>
        <div className="self-center text-[11px] text-text-dim">In →</div>
        {chain.effects.map((effect, i) => (
          <EffectCard key={effect.id} channel={ref} effect={effect} index={i} count={chain.effects.length} bpm={bpm} onInsert={setPicking} />
        ))}
        <div className="flex shrink-0 flex-col items-center gap-2 self-center">
          <button
            className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-xs text-text-dim transition-[background-color,color] duration-150 ease-out hover:bg-surface-2 hover:text-text"
            onClick={() => setPicking(chain.effects.length)}
          >
            + Add effect
          </button>
        </div>
        {picking !== null && (
          <EffectPicker
            onPick={(type) => {
              addEffect(ref, type, picking)
              setPicking(null)
            }}
            onClose={() => setPicking(null)}
          />
        )}
        <div className="self-center text-[11px] text-text-dim">→ {ref === 'master' ? 'Speakers' : 'Pan & fader'}</div>
      </div>
    </div>
  )
}
