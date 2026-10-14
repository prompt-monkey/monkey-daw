import { memo, useState } from 'react'
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
import { EFFECTS, EFFECT_TYPES, formatValue, fromNormalized, syncedValue, type ChoiceParam, type NumberParam } from './definitions'
import { BUILT_IN_PRESETS, deleteUserPreset, saveUserPreset, useUserPresets } from './presets'

/** Drag-and-drop data type carrying the id of an effect being reordered. */
const EFFECT_DRAG_TYPE = 'application/x-monkey-daw-effect'

const small = 'rounded border border-line px-2 py-0.5 text-[11px] hover:bg-surface-2 disabled:opacity-40'

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
  const track = useProjectStore((s) => (channel === 'master' ? undefined : s.project.tracks.find((t) => t.id === channel)))
  const target = effectTarget(effect.id, def.key)
  const automated = useAutomatedValue(track, target)
  const canAutomate = Boolean(track) && def.automatable !== false

  return (
    <Knob
      def={def}
      value={automated === null ? (effect.params[def.key] as number) : fromNormalized(def, automated)}
      onChange={onChange}
      onCommit={onCommit}
      disabled={disabled}
      display={display}
      automated={automated !== null}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!track) {
          toast('Automation is available on tracks (not buses or the master yet).')
          return
        }
        if (!canAutomate) {
          toast(`${def.label} can't be automated: changing it rebuilds the sound.`)
          return
        }
        addAutomationLane(track.id, target)
        useViewStore.getState().setAutomationView(track.id, target)
        toast(`Automating ${def.label} on "${track.name}": click its lane on the timeline to add points.`)
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
}: {
  channel: ChannelRef
  effect: Effect
  index: number
  count: number
  bpm: number
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
      className={`relative flex shrink-0 flex-col gap-2 rounded-lg border bg-surface p-2.5 ${
        effect.enabled ? 'border-line' : 'border-line opacity-60'
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
        className="group/header -mx-1 flex cursor-grab items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-2 active:cursor-grabbing"
        title="Drag to reorder"
      >
        <span className="text-text-dim/60 group-hover/header:text-text" aria-hidden>
          ⠿
        </span>
        <button
          className={`size-3 shrink-0 rounded-full border ${effect.enabled ? 'border-accent bg-accent' : 'border-line bg-transparent'}`}
          onClick={() => toggleEffect(channel, effect.id)}
          aria-pressed={effect.enabled}
          aria-label={effect.enabled ? `Turn ${def.name} off` : `Turn ${def.name} on`}
          title={effect.enabled ? 'On · click to bypass' : 'Bypassed · click to turn on'}
        />
        <h3 className="flex-1 text-xs font-semibold" title={def.description}>
          {def.name}
        </h3>
        <Menu
          label={`${def.name} options`}
          className="rounded px-1.5 text-xs text-text-dim hover:bg-surface-2 hover:text-text"
          items={[
            ...(index > 0 ? [{ label: 'Move left', onSelect: () => moveEffect(channel, effect.id, index - 1) }] : []),
            ...(index < count - 1 ? [{ label: 'Move right', onSelect: () => moveEffect(channel, effect.id, index + 1) }] : []),
            { label: 'Remove', onSelect: () => removeEffect(channel, effect.id), danger: true },
          ]}
        >
          ⋮
        </Menu>
      </header>

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
                  className="w-full rounded border border-line bg-bg px-1 py-0.5 text-[11px] text-text"
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
              <button className={`${small} ${on ? 'border-accent text-accent' : ''}`} onClick={() => set(p.key, !on)} aria-pressed={on}>
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
        className="w-40 rounded border border-line bg-bg px-2 py-0.5 text-xs"
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
      Presets ▾
    </Menu>
  )
}

/** The effect chain of one channel: cards in signal order, left to right. */
const GROUPS = [
  { id: 'essentials', title: 'Essentials' },
  { id: 'character', title: 'Character and space' },
] as const

/** Every effect, by group, with what it does. */
function EffectPicker({ onPick, onClose }: { onPick: (type: EffectType) => void; onClose: () => void }) {
  return (
    <Dialog title="Add effect" onClose={onClose} wide>
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        {GROUPS.map((group) => (
          <section key={group.id}>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-accent uppercase">{group.title}</h3>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EFFECT_TYPES.filter((t) => EFFECTS[t].group === group.id).map((type) => (
                <button
                  key={type}
                  onClick={() => onPick(type)}
                  className="flex flex-col items-start gap-0.5 rounded-md border border-line px-2.5 py-1.5 text-left hover:border-accent hover:bg-surface-2"
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
  const [picking, setPicking] = useState(false)
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
            className="rounded border border-line bg-bg px-1.5 py-0.5 text-xs text-text"
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
          <EffectCard key={effect.id} channel={ref} effect={effect} index={i} count={chain.effects.length} bpm={bpm} />
        ))}
        <div className="flex shrink-0 flex-col items-center gap-2 self-center">
          <button
            className="rounded-lg border border-dashed border-line px-4 py-6 text-xs text-text-dim hover:bg-surface-2 hover:text-text"
            onClick={() => setPicking(true)}
          >
            + Add effect
          </button>
        </div>
        {picking && (
          <EffectPicker
            onPick={(type) => {
              addEffect(ref, type)
              setPicking(false)
            }}
            onClose={() => setPicking(false)}
          />
        )}
        <div className="self-center text-[11px] text-text-dim">→ {ref === 'master' ? 'Speakers' : 'Pan & fader'}</div>
      </div>
    </div>
  )
}
