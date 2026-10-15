// "Kit from library": a new combination of the one-shots in the user's sample libraries, one per
// pad, chosen by each sample's category and name. Every press is another random combination.

import { detectKind, type SampleCategory } from '../library/classify'
import type { SampleInfo } from '../library/repo'
import type { Id } from '../model/types'
import { NOTE } from './kits'

/** Which samples suit each pad: a category, and optionally words the name must (or mustn't) have. */
const PAD_RULES: { note: number; categories: SampleCategory[]; name?: RegExp; notName?: RegExp }[] = [
  { note: NOTE.kick, categories: ['kick'] },
  { note: 35, categories: ['808'] },
  { note: NOTE.snare, categories: ['snare'] },
  { note: NOTE.clap, categories: ['clap'] },
  { note: NOTE.rim, categories: ['perc', 'snare'], name: /\brim/ },
  { note: NOTE.hat, categories: ['hihat'], notName: /open|\boh\b/ },
  { note: NOTE.openHat, categories: ['hihat'], name: /open|\boh\b/ },
  { note: NOTE.crash, categories: ['perc', 'hihat', 'other'], name: /crash|cymbal/ },
  { note: NOTE.ride, categories: ['perc', 'hihat', 'other'], name: /ride/ },
  { note: 45, categories: ['perc', 'other'], name: /\btom/ },
  { note: 56, categories: ['perc', 'other'], name: /cowbell|bell/ },
  { note: 70, categories: ['perc', 'other'], name: /shaker|shake|maraca/ },
  { note: 64, categories: ['perc', 'other'], name: /conga|bongo/ },
  { note: 63, categories: ['perc'] },
]

const isOneShot = (s: SampleInfo) => detectKind(s.path, s.duration) !== 'loop'

/** A random pick of one-shots for the pads (pad note → sample id); pads with no match are left out. */
export function pickLibraryKit(samples: SampleInfo[], random: () => number = Math.random): Map<number, Id> {
  const shots = samples.filter(isOneShot)
  const picks = new Map<number, Id>()
  const used = new Set<Id>()
  for (const rule of PAD_RULES) {
    const fits = shots.filter(
      (s) => rule.categories.includes(s.category) && (!rule.name || rule.name.test(s.path.toLowerCase())) && !rule.notName?.test(s.path.toLowerCase()) && !used.has(s.id),
    )
    if (!fits.length) continue
    const chosen = fits[Math.floor(random() * fits.length)]
    picks.set(rule.note, chosen.id)
    used.add(chosen.id)
  }
  return picks
}
