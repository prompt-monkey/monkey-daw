import { beforeEach, describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import {
  addBus,
  applyClipEdits,
  clipboardItems,
  deleteClips,
  duplicateClips,
  duplicateTrack,
  moveTrack,
  pasteClips,
  removeBus,
  setSend,
  setTrackOutput,
  setVolume,
  toggleMute,
} from './actions'
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

describe('track actions', () => {
  it('duplicates a track with fresh ids right below it', () => {
    const source = project().tracks[0]
    duplicateTrack(source.id)
    const copy = project().tracks[1]
    expect(copy.name).toBe('Track 1 copy')
    expect(copy.id).not.toBe(source.id)
    expect(copy.clips.map((c) => c.start)).toEqual([1, 4])
    expect(copy.clips.some((c) => source.clips.some((s) => s.id === c.id))).toBe(false)
  })

  it('moves a track to a new position', () => {
    const ids = project().tracks.map((t) => t.id)
    moveTrack(ids[0], 2)
    expect(project().tracks.map((t) => t.id)).toEqual([ids[1], ids[2], ids[0], ids[3]])
    moveTrack(ids[0], 99)
    expect(project().tracks.at(-1)?.id).toBe(ids[0])
  })
})

describe('bus actions', () => {
  it('routes tracks and sends into a bus', () => {
    const busId = addBus()
    const [a, b] = project().tracks
    setTrackOutput(a.id, busId)
    setSend(b.id, busId, 0.5)
    expect(project().tracks[0].output).toBe(busId)
    expect(project().tracks[1].sends).toEqual([{ busId, level: 0.5 }])
    setSend(b.id, busId, 0.7)
    expect(project().tracks[1].sends).toEqual([{ busId, level: 0.7 }])
    setSend(b.id, busId, 0)
    expect(project().tracks[1].sends).toEqual([])
  })

  it('ignores routing to a bus that does not exist', () => {
    const [a] = project().tracks
    setTrackOutput(a.id, 'bus_missing')
    setSend(a.id, 'bus_missing', 1)
    expect(project().tracks[0]).toMatchObject({ output: 'master', sends: [] })
  })

  it('reroutes tracks to the master when their bus is deleted, and undo restores it', () => {
    const busId = addBus()
    const [a, b] = project().tracks
    setTrackOutput(a.id, busId)
    setSend(b.id, busId, 1)
    removeBus(busId)
    expect(project().buses).toHaveLength(0)
    expect(project().tracks[0].output).toBe('master')
    expect(project().tracks[1].sends).toEqual([])
    useProjectStore.getState().undo()
    expect(project().buses.map((x) => x.id)).toEqual([busId])
    expect(project().tracks[0].output).toBe(busId)
  })

  it('sets volume and mute on buses like on tracks', () => {
    const busId = addBus()
    setVolume(busId, 0.25)
    toggleMute(busId)
    expect(project().buses[0]).toMatchObject({ volume: 0.25, muted: true })
  })
})
