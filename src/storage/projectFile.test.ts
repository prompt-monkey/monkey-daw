import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createClip, createProject } from '../model/factory'
import { InvalidProjectFileError, buildProjectFile, readProjectFile } from './projectFile'

function project() {
  const p = createProject('Corrido')
  p.assets = {
    a1: { id: 'a1', name: 'voz', duration: 1, sampleRate: 44100, channels: 2 },
    unused: { id: 'unused', name: 'old', duration: 1, sampleRate: 44100, channels: 2 },
  }
  p.tracks[0].clips = [createClip({ name: 'voz', assetId: 'a1', start: 0, duration: 1 })]
  return p
}

describe('project file', () => {
  it('round-trips the project and its audio', async () => {
    const p = project()
    const file = await buildProjectFile(p, (id) => (id === 'a1' ? new Blob(['RIFF-data'], { type: 'audio/wav' }) : undefined))
    const { project: read, audio } = await readProjectFile(file)
    expect(read.name).toBe('Corrido')
    expect(read.tracks[0].clips[0].assetId).toBe('a1')
    expect(Object.keys(read.assets)).toEqual(['a1'])
    expect(await audio.get('a1')!.text()).toBe('RIFF-data')
    expect(audio.get('a1')!.type).toBe('audio/wav')
  })

  it('rejects files that are not project files', async () => {
    await expect(readProjectFile(new Blob(['hello']))).rejects.toBeInstanceOf(InvalidProjectFileError)
    const other = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'something-else' })) })])
    await expect(readProjectFile(other)).rejects.toThrow(/not a monkey-daw/)
  })

  it('rejects a project file with missing audio', async () => {
    const p = project()
    const manifest = { format: 'monkey-daw-project', formatVersion: 1, project: p, audio: [] }
    const broken = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })])
    await expect(readProjectFile(broken)).rejects.toThrow(/missing 1 audio/)
  })

  it('rejects files from a newer format version', async () => {
    const manifest = { format: 'monkey-daw-project', formatVersion: 99, project: project(), audio: [] }
    const newer = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })])
    await expect(readProjectFile(newer)).rejects.toThrow(/newer version/)
  })
})
