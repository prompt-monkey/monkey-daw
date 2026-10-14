import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../model/factory'
import { normalizeProject } from '../model/migrate'
import type { LyricSection } from '../model/types'
import { addLyricSection, moveLyricSection, removeLyricSection, setLyricKind, setLyricText } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { lyricsStats, lyricsText, sectionLabels } from './lyrics'

const s = (kind: LyricSection['kind'], text = ''): LyricSection => ({ id: `${kind}${Math.random()}`, kind, text })
const lyrics = () => useProjectStore.getState().project.lyrics

describe('section labels', () => {
  it('number verses always, other kinds only when repeated', () => {
    expect(sectionLabels([s('intro'), s('verse'), s('chorus'), s('verse'), s('chorus'), s('bridge')])).toEqual([
      'Intro',
      'Verse 1',
      'Chorus 1',
      'Verse 2',
      'Chorus 2',
      'Bridge',
    ])
  })
})

describe('lyrics text', () => {
  it('writes headed sections separated by blank lines, with an optional title', () => {
    const sections = [s('verse', 'Line one\nLine two\n\n'), s('chorus', '  Hey  '), s('outro')]
    expect(lyricsText(sections)).toBe('[Verse 1]\nLine one\nLine two\n\n[Chorus]\nHey\n\n[Outro]\n')
    expect(lyricsText([s('verse', 'La')], 'My song')).toBe('My song\n\n[Verse 1]\nLa\n')
  })

  it('counts lines and words', () => {
    expect(lyricsStats([s('verse', 'one two\n\n three '), s('chorus', 'four')])).toEqual({ lines: 3, words: 4 })
  })
})

describe('lyrics actions', () => {
  beforeEach(() => useProjectStore.getState().load(createProject()))

  it('add, edit, retype, move and delete sections, undoably', () => {
    const verse = addLyricSection('verse')
    const chorus = addLyricSection('chorus')
    addLyricSection('intro', 0)
    expect(lyrics().map((x) => x.kind)).toEqual(['intro', 'verse', 'chorus'])

    setLyricText(verse, 'Hel')
    setLyricText(verse, 'Hello')
    useProjectStore.getState().endGesture()
    setLyricKind(chorus, 'bridge')
    moveLyricSection(chorus, 0)
    expect(lyrics().map((x) => x.kind)).toEqual(['bridge', 'intro', 'verse'])
    removeLyricSection(verse)
    expect(lyrics()).toHaveLength(2)

    // Undo: delete, move, kind change, then the typing as a single step.
    for (let i = 0; i < 3; i++) useProjectStore.getState().undo()
    expect(lyrics().find((x) => x.id === verse)!.text).toBe('Hello')
    useProjectStore.getState().undo()
    expect(lyrics().find((x) => x.id === verse)!.text).toBe('')
  })

  it('load with the project, repairing what they can', () => {
    addLyricSection('chorus')
    setLyricText(lyrics()[0].id, 'Oh')
    const raw = JSON.parse(JSON.stringify(useProjectStore.getState().project))
    expect(normalizeProject(raw).lyrics).toEqual(lyrics())
    raw.lyrics = [{ id: 'a', kind: 'rap', text: 5 }, { kind: 'verse' }, 'x']
    expect(normalizeProject(raw).lyrics).toEqual([{ id: 'a', kind: 'verse', text: '' }])
    delete raw.lyrics
    expect(normalizeProject(raw).lyrics).toEqual([])
  })
})
