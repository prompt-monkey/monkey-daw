import { describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import { exportFilename, exportRange } from './export'

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
