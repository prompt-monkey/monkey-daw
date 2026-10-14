// Guesses sample metadata from file and folder names: instrument category, tempo, time
// signature and whether it's a loop or a one-shot. Spanish and English names are recognised.

export type SampleCategory =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hihat'
  | 'perc'
  | '808'
  | 'drums'
  | 'bass'
  | 'tololoche'
  | 'requinto'
  | 'guitar'
  | 'keys'
  | 'synth'
  | 'pad'
  | 'pluck'
  | 'brass'
  | 'vocals'
  | 'fx'
  | 'other'

export type SampleKind = 'loop' | 'one-shot'

export const CATEGORY_LABELS: Record<SampleCategory, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hihat: 'Hi-hat',
  perc: 'Perc',
  '808': '808',
  drums: 'Drums',
  bass: 'Bass',
  tololoche: 'Tololoche',
  requinto: 'Requinto',
  guitar: 'Guitar',
  keys: 'Keys',
  synth: 'Synth',
  pad: 'Pad',
  pluck: 'Pluck',
  brass: 'Brass',
  vocals: 'Vocals',
  fx: 'FX',
  other: 'Other',
}

const CATEGORY_HUES: Record<SampleCategory, number> = {
  kick: 150,
  snare: 120,
  clap: 100,
  hihat: 85,
  perc: 60,
  '808': 20,
  drums: 45,
  bass: 35,
  tololoche: 270,
  requinto: 90,
  guitar: 30,
  keys: 330,
  synth: 200,
  pad: 230,
  pluck: 125,
  brass: 250,
  vocals: 350,
  fx: 110,
  other: 0,
}

export function categoryColor(category: SampleCategory): string {
  return category === 'other' ? 'oklch(70% 0 0)' : `oklch(74% 0.14 ${CATEGORY_HUES[category]})`
}

// Checked in order: the first match wins, so specific names come before generic ones.
const CATEGORY_PATTERNS: [SampleCategory, RegExp][] = [
  ['808', /\b808s?\b/],
  ['tololoche', /\btolo(loche)?s?\b|\bcontrabajo\b|\bupright\b/],
  ['requinto', /\breq(uinto)?s?\b/],
  ['kick', /\bkicks?\b|\bbombos?\b|\bbd\b/],
  ['snare', /\bsnares?\b|\btarolas?\b|\bsd\b|\brims?(shot)?\b/],
  ['clap', /\bclaps?\b|\bpalmas?\b/],
  ['hihat', /\bhi[\s-]?hats?\b|\bhats?\b|\bhh\b|\bcharchetas?\b|\bplatillos?\b|\bcymbals?\b|\bride\b|\bcrash\b|\bopen[\s-]?hat\b/],
  ['drums', /\bdrums?\b|\bbater[ií]as?\b|\bdrum[\s-]?loops?\b|\bbreaks?\b/],
  ['perc', /\bpercs?\b|\bpercussions?\b|\bpercusi[oó]n\b|\bshakers?\b|\bcongas?\b|\bbongos?\b|\bg[uü]iros?\b|\btoms?\b|\bbells?\b|\bcampanas?\b/],
  // The bajo sexto is a 12-string guitar, so "bajo" only means bass when "sexto" doesn't follow.
  ['bass', /\bbass(es)?\b|\bbajos?\b(?![\s-]?sextos?\b)/],
  ['guitar', /\bguitars?\b|\bguitarras?\b|\bgtr\b|\bdocerolas?\b|\bbajos?[\s-]?sextos?\b|\b12[\s-]?cuerdas\b|\bacoustic\b/],
  ['keys', /\bkeys\b|\bpianos?\b|\brhodes\b|\borgans?\b|\b[oó]rganos?\b|\bacorde[oó]n\b|\baccordion\b/],
  ['brass', /\bbrass\b|\btrombon(es)?\b|\btromb[oó]n\b|\btrumpets?\b|\btrompetas?\b|\bsax(ophone)?s?\b|\bmetales\b|\bhorns?\b|\bcharcheta\b/],
  ['vocals', /\bvox\b|\bvocals?\b|\bvoz\b|\bvoces\b|\bvoice\b|\bchants?\b|\bcoros?\b|\bad[\s-]?libs?\b/],
  ['pad', /\bpads?\b|\batmos(phere)?s?\b|\bambien(t|ce)\b/],
  ['pluck', /\bplucks?\b/],
  ['synth', /\bsynths?\b|\bleads?\b|\bsintes?\b|\bsintetizador\b|\barps?\b/],
  ['fx', /\bfx\b|\bsfx\b|\beffects?\b|\befectos?\b|\brisers?\b|\bimpacts?\b|\bsweeps?\b|\btransitions?\b|\bdowns?\b|\buplifters?\b/],
]

/** Lower-cases and turns separators (_ - . /) into spaces so \b works on file names. */
function words(path: string): string {
  return path
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/[_./\\()[\]]+/g, ' ')
}

/** Category from the file name first, then from the folders it sits in. */
export function detectCategory(path: string): SampleCategory {
  const parts = path.split(/[\\/]/).reverse()
  for (const part of parts) {
    const text = words(part)
    for (const [category, pattern] of CATEGORY_PATTERNS) if (pattern.test(text)) return category
  }
  return 'other'
}

export function detectBpm(path: string): number | null {
  const text = path.toLowerCase()
  const match = text.match(/(\d{2,3}(?:\.\d+)?)\s*[-_ ]?\s*bpm/) ?? text.match(/bpm\s*[-_ ]?\s*(\d{2,3}(?:\.\d+)?)/)
  if (!match) return null
  const bpm = Number(match[1])
  return bpm >= 40 && bpm <= 250 ? bpm : null
}

export const SIGNATURES = ['4/4', '3/4', '6/8', '2/4', '12/8'] as const
export type SignatureTag = (typeof SIGNATURES)[number]

export function detectSignature(path: string): SignatureTag | null {
  const match = path.match(/(?:^|[^\d])(12|[2346])\s*[/_\- ]\s*([48])(?=$|[^\d])/)
  if (!match) return null
  const tag = `${match[1]}/${match[2]}`
  return (SIGNATURES as readonly string[]).includes(tag) ? (tag as SignatureTag) : null
}

/** Below this length a sample counts as a one-shot unless its name says otherwise. */
export const ONE_SHOT_MAX_SECONDS = 1.5

export function detectKind(path: string, duration?: number | null): SampleKind | null {
  const text = words(path)
  if (/\bone[\s-]?shots?\b|\boneshots?\b|\bshots?\b|\bhits?\b/.test(text)) return 'one-shot'
  if (/\bloops?\b|\bbeats?\b/.test(text)) return 'loop'
  if (duration != null) return duration < ONE_SHOT_MAX_SECONDS ? 'one-shot' : 'loop'
  return null
}

export const AUDIO_EXTENSIONS = /\.(wav|mp3|ogg|flac|m4a)$/i
