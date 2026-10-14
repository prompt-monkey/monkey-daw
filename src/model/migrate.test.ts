import { describe, expect, it } from 'vitest'
import { createClip, createProject } from './factory'
import { InvalidProjectError, normalizeProject, usedAssetIds } from './migrate'

describe('normalizeProject', () => {
  it('keeps a valid project as it is', () => {
    const p = createProject()
    p.tracks[0].clips = [createClip({ name: 'a', assetId: 'x', start: 1, duration: 2 })]
    expect(normalizeProject(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })

  it('fills in fields that older data lacks', () => {
    const p = normalizeProject({
      version: 1,
      id: 'prj_old',
      name: 'Old',
      tracks: [{ id: 't1', name: 'T', clips: [{ id: 'c1', assetId: 'x', start: 0, duration: 1 }] }],
    })
    expect(p.buses).toEqual([])
    expect(p.tracks[0]).toMatchObject({ output: 'master', sends: [], volume: 1, pan: 0, kind: 'audio' })
    expect(p.tracks[0].clips[0]).toMatchObject({ offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 })
    expect(p.timeSignature).toEqual({ beats: 4, unit: 4 })
  })

  it('drops routing to buses that do not exist and broken clips', () => {
    const p = normalizeProject({
      version: 1,
      tracks: [
        {
          id: 't1',
          output: 'bus_gone',
          sends: [{ busId: 'bus_gone', level: 1 }],
          clips: [{ id: 'c1', assetId: 'x', start: 0, duration: 0 }, { id: 'c2' }],
        },
      ],
    })
    expect(p.tracks[0]).toMatchObject({ output: 'master', sends: [], clips: [] })
  })

  it('rejects data that is not a project', () => {
    expect(() => normalizeProject(null)).toThrow(InvalidProjectError)
    expect(() => normalizeProject({ version: 2, tracks: [] })).toThrow(/version/)
    expect(() => normalizeProject({ version: 1 })).toThrow(/track/)
  })
})

describe('usedAssetIds', () => {
  it('lists each asset used by a clip once', () => {
    const p = createProject()
    p.tracks[0].clips = [
      createClip({ name: 'a', assetId: 'x', start: 0, duration: 1 }),
      createClip({ name: 'b', assetId: 'x', start: 2, duration: 1 }),
    ]
    p.tracks[1].clips = [createClip({ name: 'c', assetId: 'y', start: 0, duration: 1 })]
    expect(usedAssetIds(p).sort()).toEqual(['x', 'y'])
  })
})
