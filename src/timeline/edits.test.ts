import { describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import type { Clip } from '../model/types'
import {
  MIN_CLIP_DURATION,
  applyPreview,
  clipsInRect,
  formatGain,
  moveClips,
  setFadeIn,
  setFadeOut,
  setGain,
  trimEnd,
  trimStart,
} from './edits'

const clip = (fields: Partial<Clip> = {}) => createClip({ name: 'c', assetId: 'a', start: 2, duration: 4, ...fields })
const noSnap = (t: number) => Math.max(0, t)
const beatSnap = (t: number) => Math.max(0, Math.round(t * 2) / 2)

describe('moveClips', () => {
  const ids = ['t0', 't1', 't2']

  it('snaps the grabbed clip and moves the group with it', () => {
    const a = clip({ start: 2 })
    const b = clip({ start: 5 })
    const preview = moveClips(
      [
        { clip: a, trackIndex: 0 },
        { clip: b, trackIndex: 1 },
      ],
      a,
      1.2,
      0,
      ids,
      beatSnap,
    )
    expect(preview[a.id]).toEqual({ trackId: 't0', fields: { start: 3 } })
    expect(preview[b.id]).toEqual({ trackId: 't1', fields: { start: 6 } })
  })

  it('stops the group at time 0', () => {
    const a = clip({ start: 2 })
    const b = clip({ start: 1 })
    const preview = moveClips(
      [
        { clip: a, trackIndex: 0 },
        { clip: b, trackIndex: 0 },
      ],
      a,
      -5,
      0,
      ids,
      noSnap,
    )
    expect(preview[b.id].fields.start).toBe(0)
    expect(preview[a.id].fields.start).toBe(1)
  })

  it('moves across tracks without leaving the track list', () => {
    const a = clip()
    const b = clip()
    const group = [
      { clip: a, trackIndex: 0 },
      { clip: b, trackIndex: 1 },
    ]
    expect(moveClips(group, a, 0, 1, ids, noSnap)[b.id].trackId).toBe('t2')
    const capped = moveClips(group, a, 0, 5, ids, noSnap)
    expect(capped[a.id].trackId).toBe('t1')
    expect(capped[b.id].trackId).toBe('t2')
    expect(moveClips(group, a, 0, -3, ids, noSnap)[a.id].trackId).toBe('t0')
  })
})

describe('trim', () => {
  it('trims the start and keeps the audio in place', () => {
    expect(trimStart(clip({ start: 2, offset: 1, duration: 4 }), 3)).toMatchObject({ start: 3, offset: 2, duration: 3 })
  })

  it('cannot extend the start past the beginning of the audio', () => {
    expect(trimStart(clip({ start: 2, offset: 1, duration: 4 }), 0)).toMatchObject({ start: 1, offset: 0, duration: 5 })
  })

  it('keeps a minimum length', () => {
    expect(trimStart(clip({ start: 2, duration: 4 }), 10).duration).toBeCloseTo(MIN_CLIP_DURATION)
    expect(trimEnd(clip({ start: 2, duration: 4 }), 10, 0).duration).toBeCloseTo(MIN_CLIP_DURATION)
  })

  it('cannot extend the end past the end of the audio', () => {
    expect(trimEnd(clip({ start: 2, offset: 1, duration: 4 }), 6, 20).duration).toBe(5)
  })

  it('shrinks fades that no longer fit', () => {
    expect(trimEnd(clip({ duration: 4, fadeIn: 1, fadeOut: 2 }), 10, 3.5)).toMatchObject({ duration: 1.5, fadeIn: 1, fadeOut: 0.5 })
  })
})

describe('fades and gain', () => {
  it('keeps fades inside the clip', () => {
    expect(setFadeIn(clip({ duration: 4, fadeOut: 1 }), 10).fadeIn).toBe(3)
    expect(setFadeIn(clip(), -1).fadeIn).toBe(0)
    expect(setFadeOut(clip({ duration: 4, fadeIn: 3 }), 2).fadeOut).toBe(1)
  })

  it('clamps gain and formats it in dB', () => {
    expect(setGain(5).gain).toBe(2)
    expect(setGain(-1).gain).toBe(0)
    expect(formatGain(1)).toBe('+0.0 dB')
    expect(formatGain(0.5)).toBe('-6.0 dB')
    expect(formatGain(0)).toBe('-inf dB')
  })
})

describe('applyPreview', () => {
  it('patches clips and moves them between tracks', () => {
    const p = createProject()
    const c = clip({ start: 1 })
    p.tracks[0].clips = [c]
    const tracks = applyPreview(p.tracks, { [c.id]: { trackId: p.tracks[2].id, fields: { start: 4 } } })
    expect(tracks[0].clips).toHaveLength(0)
    expect(tracks[2].clips[0]).toMatchObject({ id: c.id, start: 4 })
    expect(p.tracks[0].clips[0].start).toBe(1)
  })

  it('returns the same tracks without a preview', () => {
    const p = createProject()
    expect(applyPreview(p.tracks, null)).toBe(p.tracks)
  })
})

describe('clipsInRect', () => {
  it('finds clips touching the rectangle, in either drag direction', () => {
    const p = createProject()
    const a = clip({ start: 0, duration: 2 })
    const b = clip({ start: 5, duration: 2 })
    const c = clip({ start: 1, duration: 1 })
    p.tracks[0].clips = [a, b]
    p.tracks[2].clips = [c]
    expect(clipsInRect(p.tracks, 1.5, 0.5, 0, 0)).toEqual([a.id])
    expect(clipsInRect(p.tracks, 0, 10, 2, 0).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(clipsInRect(p.tracks, 2, 5, 0, 0)).toEqual([])
  })
})
