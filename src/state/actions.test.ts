import { beforeEach, describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import { applyClipEdits, clipboardItems, deleteClips, duplicateClips, pasteClips } from './actions'
import { useProjectStore } from './projectStore'

const project = () => useProjectStore.getState().project

beforeEach(() => {
  const p = createProject()
  p.tracks[0].clips = [
    createClip({ name: 'a', assetId: 'x', start: 1, duration: 2 }),
    createClip({ name: 'b', assetId: 'x', start: 4, duration: 1 }),
  ]
  useProjectStore.getState().load(p)
})

describe('clip actions', () => {
  it('applies a gesture as one undo step, moving clips between tracks', () => {
    const [a, b] = project().tracks[0].clips
    const target = project().tracks[1].id
    applyClipEdits('Move clips', [
      { clipId: a.id, trackId: target, fields: { start: 2 } },
      { clipId: b.id, trackId: target, fields: { start: 5 } },
    ])
    expect(project().tracks[0].clips).toHaveLength(0)
    expect(project().tracks[1].clips.map((c) => c.start)).toEqual([2, 5])
    useProjectStore.getState().undo()
    expect(project().tracks[0].clips.map((c) => c.start)).toEqual([1, 4])
  })

  it('deletes clips', () => {
    const [a] = project().tracks[0].clips
    deleteClips([a.id])
    expect(project().tracks[0].clips.map((c) => c.name)).toEqual(['b'])
  })

  it('duplicates a selection right after itself', () => {
    const ids = project().tracks[0].clips.map((c) => c.id)
    const copies = duplicateClips(ids)
    const clips = project().tracks[0].clips
    expect(clips).toHaveLength(4)
    expect(clips.filter((c) => copies.includes(c.id)).map((c) => c.start)).toEqual([5, 8])
  })

  it('pastes at a time, keeping relative timing and tracks', () => {
    const items = clipboardItems(project(), project().tracks[0].clips.map((c) => c.id))
    const ids = pasteClips(items, 10)
    const pasted = project().tracks[0].clips.filter((c) => ids.includes(c.id))
    expect(pasted.map((c) => c.start)).toEqual([10, 13])
    expect(new Set([...ids, ...items.map((i) => i.clip.id)]).size).toBe(4)
  })
})
