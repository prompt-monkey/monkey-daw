// An ordered chain of effect instances between an input and an output node. Syncing with the
// project's effect list creates, updates, removes and rewires instances as needed.

import type { Effect, Id } from '../model/types'
import { createEffectInstance, type EffectInstance } from './nodes'

interface Entry {
  effect: Effect
  bpm: number
  instance: EffectInstance
}

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

  sync(effects: Effect[], bypass: boolean, bpm: number, immediate: boolean) {
    const ids = new Set(effects.map((e) => e.id))
    for (const [id, entry] of this.entries) {
      if (ids.has(id)) continue
      entry.instance.dispose()
      this.entries.delete(id)
    }
    for (const effect of effects) {
      const entry = this.entries.get(effect.id)
      if (!entry) {
        const instance = createEffectInstance(this.ctx, effect)
        instance.update(effect.params, bpm, true)
        this.entries.set(effect.id, { effect, bpm, instance })
      } else if (entry.effect !== effect || (entry.bpm !== bpm && effect.type === 'delay')) {
        entry.instance.update(effect.params, bpm, immediate)
        entry.effect = effect
        entry.bpm = bpm
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

  dispose() {
    for (const entry of this.entries.values()) entry.instance.dispose()
    this.entries.clear()
    this.input.disconnect()
    this.output.disconnect()
  }
}
