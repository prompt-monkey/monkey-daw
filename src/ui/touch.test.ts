import { beforeEach, describe, expect, it } from 'vitest'
import { VOICE_LABELS } from '../drums/kits'
import { signatureMismatch } from '../library/audio'
import { useLibraryStore } from '../library/store'
import { createProject, createTrack } from '../model/factory'
import { MAX_KEY_H, MIN_KEY_H, usePianoRollStore } from '../pianoroll/store'
import { setPad } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { createKit } from '../drums/kits'

describe('picking a sample from the library', () => {
  it('opens the library for a pick, and closing it cancels the pick', () => {
    const view = useViewStore.getState()
    view.setLibraryOpen(false)
    view.setClipBubble({ clipId: 'c', x: 0, y: 0 })
    view.setLibraryPick({ kind: 'append', trackId: 't' })
    expect(useViewStore.getState()).toMatchObject({ libraryOpen: true, libraryPick: { kind: 'append', trackId: 't' }, clipBubble: null })
    useViewStore.getState().setLibraryOpen(false)
    expect(useViewStore.getState().libraryPick).toBeNull()
  })

  it('notices a sample in another time signature', () => {
    useProjectStore.getState().load(createProject())
    const base = { libraryId: 'l', type: 'audio/wav', size: 1, category: 'drums' as const, bpm: null, duration: 4 }
    useLibraryStore.setState({
      samples: [
        { ...base, id: 'a', path: 'a 6-8.wav', name: 'a', signature: '6/8' },
        { ...base, id: 'b', path: 'b 4-4.wav', name: 'b', signature: '4/4' },
        { ...base, id: 'c', path: 'c.wav', name: 'c', signature: null },
      ],
    })
    expect([signatureMismatch('a'), signatureMismatch('b'), signatureMismatch('c')]).toEqual(['6/8', null, null])
  })
})

describe('drum rows', () => {
  beforeEach(() => {
    const p = createProject()
    const drums = createTrack('Drums', 'drums')
    drums.kit = createKit()
    p.tracks = [drums]
    useProjectStore.getState().load(p)
  })

  it('changes a row to another synthesized sound', () => {
    const track = useProjectStore.getState().project.tracks[0]
    setPad(track.id, 36, { voice: 'sub' })
    const pad = useProjectStore.getState().project.tracks[0].kit!.pads.find((p) => p.note === 36)!
    expect(pad.voice).toBe('sub')
    expect(VOICE_LABELS.sub).toBe('Sub kick')
  })
})

describe('piano roll zoom', () => {
  it('keeps the key rows within their range', () => {
    usePianoRollStore.getState().setKeyH(100)
    expect(usePianoRollStore.getState().keyH).toBe(MAX_KEY_H)
    usePianoRollStore.getState().setKeyH(1)
    expect(usePianoRollStore.getState().keyH).toBe(MIN_KEY_H)
  })
})
