// Song lyrics: section names and the plain-text form used for copying and downloading.

import type { LyricSection, LyricSectionKind } from '../model/types'

export const LYRIC_KINDS: LyricSectionKind[] = ['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'solo', 'outro']

export const KIND_NAMES: Record<LyricSectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  'pre-chorus': 'Pre-chorus',
  chorus: 'Chorus',
  bridge: 'Bridge',
  solo: 'Solo',
  outro: 'Outro',
}

/**
 * Display names in song order: verses are always numbered ("Verse 2"); other kinds only when
 * the song has more than one of them.
 */
export function sectionLabels(sections: LyricSection[]): string[] {
  const totals = new Map<LyricSectionKind, number>()
  for (const s of sections) totals.set(s.kind, (totals.get(s.kind) ?? 0) + 1)
  const seen = new Map<LyricSectionKind, number>()
  return sections.map((s) => {
    const n = (seen.get(s.kind) ?? 0) + 1
    seen.set(s.kind, n)
    return s.kind === 'verse' || totals.get(s.kind)! > 1 ? `${KIND_NAMES[s.kind]} ${n}` : KIND_NAMES[s.kind]
  })
}

/** The lyrics as plain text: "[Verse 1]" headings, sections separated by a blank line. */
export function lyricsText(sections: LyricSection[], title?: string): string {
  const labels = sectionLabels(sections)
  const body = sections.map((s, i) => `[${labels[i]}]\n${s.text.trim()}`.trimEnd()).join('\n\n')
  return title ? `${title}\n\n${body}\n` : `${body}\n`
}

/** Lines and words across all sections. */
export function lyricsStats(sections: LyricSection[]): { lines: number; words: number } {
  const lines = sections.flatMap((s) => s.text.split('\n')).filter((l) => l.trim())
  return { lines: lines.length, words: lines.reduce((n, l) => n + l.trim().split(/\s+/).length, 0) }
}
