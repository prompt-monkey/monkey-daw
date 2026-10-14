import { describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import { exportFilename, exportRange, stemFilename, stemProject, stemTracks } from './export'
import { encodeMp3 } from './mp3'

describe('exportRange', () => {
  it('covers the project from 0 to the end of the last clip', () => {
    const p = createProject()
    expect(exportRange(p, 'project')).toBeNull()
    p.tracks[1].clips = [createClip({ name: 'a', assetId: 'x', start: 3, duration: 2.5 })]
    expect(exportRange(p, 'project')).toEqual({ start: 0, end: 5.5 })
  })

  it('covers the loop region only when the loop is on', () => {
    const p = createProject()
    p.loop = { enabled: false, start: 2, end: 6 }
    expect(exportRange(p, 'loop')).toBeNull()
    p.loop.enabled = true
    expect(exportRange(p, 'loop')).toEqual({ start: 2, end: 6 })
  })
})

describe('exportFilename', () => {
  it('builds a safe file name from the project name', () => {
    expect(exportFilename('Mi Corrido: versión 2/final', 'project')).toBe('Mi Corrido version 2final.wav')
    expect(exportFilename('Beat', 'loop')).toBe('Beat (loop).wav')
    expect(exportFilename('***', 'project')).toBe('mix.wav')
  })
})

describe('export file names', () => {
  it('uses the format extension and a suffix for stems', () => {
    expect(exportFilename('Beat', 'project', 'mp3')).toBe('Beat.mp3')
    expect(exportFilename('Beat', 'loop', 'zip', ' stems')).toBe('Beat stems (loop).zip')
    expect(stemFilename(2, 'Lead / vocal', 'wav')).toBe('03 Lead vocal.wav')
    expect(stemFilename(0, '???', 'mp3')).toBe('01 Track.mp3')
  })
})

describe('stems', () => {
  it('come from unmuted tracks with clips, each heard alone', () => {
    const p = createProject()
    p.tracks[0].clips = [createClip({ name: 'a', assetId: 'x', start: 0, duration: 1 })]
    p.tracks[1].clips = [createClip({ name: 'b', assetId: 'x', start: 0, duration: 1 })]
    p.tracks[2].clips = [createClip({ name: 'c', assetId: 'x', start: 0, duration: 1 })]
    p.tracks[1].muted = true
    p.tracks[2].solo = true
    expect(stemTracks(p).map((t) => t.id)).toEqual([p.tracks[0].id, p.tracks[2].id])
    const stem = stemProject(p, p.tracks[0].id)
    expect(stem.tracks.map((t) => [t.muted, t.solo])).toEqual([
      [false, false],
      [true, false],
      [true, false],
      [true, false],
    ])
    expect(p.tracks[2].solo).toBe(true)
  })
})

describe('encodeMp3', () => {
  it('encodes stereo audio as MP3 frames at the chosen bitrate', () => {
    const sampleRate = 44100
    const tone = Float32Array.from({ length: sampleRate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate))
    const mp3 = encodeMp3([tone, tone], sampleRate, 128)
    // MPEG-1 Layer III frame sync.
    expect(mp3[0]).toBe(0xff)
    expect(mp3[1] & 0xe0).toBe(0xe0)
    // About 128 kbps × 1 s = 16 kB.
    expect(mp3.length).toBeGreaterThan(14000)
    expect(mp3.length).toBeLessThan(19000)
    expect(encodeMp3([tone], sampleRate, 320).length).toBeGreaterThan(mp3.length)
  })
})
