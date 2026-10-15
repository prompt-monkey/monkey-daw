// Automation targets: what a lane controls, how its 0–1 values map to real values, and labels.

import { EFFECTS, automatableParams, findParam, formatValue, fromNormalized, toNormalized, type NumberParam } from '../effects/definitions'
import { faderToGain, formatDb, gainToFader } from '../model/levels'
import type { AutomatedChannel, AutomationTarget, Id } from '../model/types'

export type ParsedTarget = { kind: 'volume' } | { kind: 'pan' } | { kind: 'effect'; effectId: Id; param: string }

export function parseTarget(target: AutomationTarget): ParsedTarget | null {
  if (target === 'volume' || target === 'pan') return { kind: target }
  const match = /^fx:([^:]+):([^:]+)$/.exec(target)
  return match ? { kind: 'effect', effectId: match[1], param: match[2] } : null
}

export const effectTarget = (effectId: Id, param: string): AutomationTarget => `fx:${effectId}:${param}`

export interface ResolvedTarget {
  target: AutomationTarget
  label: string
  /** Real value (gain, pan, Hz, dB…) for a 0–1 automation value. */
  toReal: (value: number) => number
  /** 0–1 automation value for a real value. */
  fromReal: (real: number) => number
  /** Display text for a 0–1 automation value. */
  format: (value: number) => string
  /** The control's current (non-automated) real value. */
  manual: number
}

const formatPan = (pan: number) => (Math.abs(pan) < 0.005 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`)

/**
 * Resolves a lane's target on a track, bus or the master; null if it doesn't exist there (the
 * effect was removed, or pan on the master).
 */
export function resolveTarget(track: AutomatedChannel, target: AutomationTarget): ResolvedTarget | null {
  const parsed = parseTarget(target)
  if (!parsed) return null
  if (parsed.kind === 'volume') {
    return {
      target,
      label: 'Volume',
      toReal: faderToGain,
      fromReal: gainToFader,
      format: (v) => `${formatDb(faderToGain(v))} dB`,
      manual: track.volume,
    }
  }
  if (parsed.kind === 'pan') {
    if (track.pan === undefined) return null
    const pan = track.pan
    return {
      target,
      label: 'Pan',
      toReal: (v) => v * 2 - 1,
      fromReal: (pan) => (pan + 1) / 2,
      format: (v) => formatPan(v * 2 - 1),
      manual: pan,
    }
  }
  const effect = track.effects.find((e) => e.id === parsed.effectId)
  const def = effect && findParam(effect.type, parsed.param)
  if (!effect || !def || def.kind !== 'number' || def.automatable === false) return null
  const sameType = track.effects.filter((e) => e.type === effect.type)
  const name = EFFECTS[effect.type].name + (sameType.length > 1 ? ` ${sameType.indexOf(effect) + 1}` : '')
  return {
    target,
    label: `${name} · ${def.label}`,
    toReal: (v) => fromNormalized(def, v),
    fromReal: (real) => toNormalized(def, real),
    format: (v) => formatValue(def as NumberParam, fromNormalized(def, v)),
    manual: effect.params[def.key] as number,
  }
}

/** Every target a track, bus or the master can automate, in display order. */
export function availableTargets(track: AutomatedChannel): { target: AutomationTarget; label: string }[] {
  const out = [{ target: 'volume', label: 'Volume' }]
  if (track.pan !== undefined) out.push({ target: 'pan', label: 'Pan' })
  for (const effect of track.effects) {
    for (const def of automatableParams(effect.type)) {
      const resolved = resolveTarget(track, effectTarget(effect.id, def.key))
      if (resolved) out.push({ target: resolved.target, label: resolved.label })
    }
  }
  return out
}
