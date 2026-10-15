// An ordered chain of effect instances between an input and an output node. Syncing with the
// project's effect list creates, updates, removes and rewires instances as needed.

import type { Effect, Id } from '../model/types'
import { EFFECTS } from './definitions'
import { createEffectInstance, type Binding, type EffectInstance } from './nodes'
import type { ScheduleWindow } from './parts'

interface Entry {
  effect: Effect
  bpm: number
  /** Automated parameter keys at the last update, joined, to notice when lanes change. */
  automated: string
  instance: EffectInstance
}

const NONE: ReadonlySet<string> = new Set()

export class EffectChain {
  readonly input: GainNode
  readonly output: GainNode
  private ctx: BaseAudioContext
  private entries = new Map<Id, Entry>()
  /** Ids of the effects currently wired in, in order; rewiring happens when this changes. */
  private wired: Id[] | null = null

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
  }

  /**
   * `automated` lists, per effect id, the parameters automation is driving; those are left to
   * the automation scheduler.
   */
  sync(effects: Effect[], bypass: boolean, bpm: number, immediate: boolean, automated?: ReadonlyMap<Id, ReadonlySet<string>>) {
    const ids = new Set(effects.map((e) => e.id))
    for (const [id, entry] of this.entries) {
      if (ids.has(id)) continue
      entry.instance.dispose()
      this.entries.delete(id)
    }
    for (const effect of effects) {
      const keys = automated?.get(effect.id) ?? NONE
      const signature = [...keys].sort().join(',')
      const entry = this.entries.get(effect.id)
      if (!entry) {
        const instance = createEffectInstance(this.ctx, effect)
        instance.update(effect.params, bpm, true, keys)
        this.entries.set(effect.id, { effect, bpm, automated: signature, instance })
      } else if (entry.effect !== effect || entry.automated !== signature || (entry.bpm !== bpm && EFFECTS[effect.type].sync)) {
        entry.instance.update(effect.params, bpm, immediate, keys)
        entry.effect = effect
        entry.bpm = bpm
        entry.automated = signature
      }
    }

    const active = bypass ? [] : effects.filter((e) => e.enabled).map((e) => e.id)
    if (this.wired && active.length === this.wired.length && active.every((id, i) => id === this.wired![i])) return
    this.input.disconnect()
    for (const entry of this.entries.values()) entry.instance.output.disconnect()
    let node: AudioNode = this.input
    for (const id of active) {
      const { instance } = this.entries.get(id)!
      node.connect(instance.input)
      node = instance.output
    }
    node.connect(this.output)
    this.wired = active
  }

  /** Lets effects that follow the song position (sidechain duck) schedule a window. */
  schedule(window: ScheduleWindow, ctxOffset: number, bpm: number) {
    for (const id of this.wired ?? []) {
      const entry = this.entries.get(id)
      entry?.instance.schedule?.(window, ctxOffset, entry.effect.params, bpm)
    }
  }

  /** An effect's live reading (see EffectInstance.monitor), or null. */
  monitor(effectId: Id): unknown {
    return this.entries.get(effectId)?.instance.monitor?.() ?? null
  }

  /** The AudioParams an effect parameter drives, for automation. */
  bindings(effectId: Id, key: string): Binding[] {
    return this.entries.get(effectId)?.instance.bindings(key) ?? []
  }

  dispose() {
    for (const entry of this.entries.values()) entry.instance.dispose()
    this.entries.clear()
    this.input.disconnect()
    this.output.disconnect()
  }
}
