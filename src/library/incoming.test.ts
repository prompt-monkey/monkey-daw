import { describe, expect, it } from 'vitest'
import { fromFileList } from './incoming'

const file = (name: string, relative = '') => {
  const f = new File(['x'], name)
  Object.defineProperty(f, 'webkitRelativePath', { value: relative })
  return f
}

describe('fromFileList', () => {
  it('groups a picked folder into one library named after it', () => {
    const libs = fromFileList([file('kick.wav', 'Pack/Drums/kick.wav'), file('req.wav', 'Pack/req.wav')])
    expect(libs).toHaveLength(1)
    expect(libs[0].name).toBe('Pack')
    expect(libs[0].files.map((f) => f.path)).toEqual(['Pack/Drums/kick.wav', 'Pack/req.wav'])
  })

  it('puts loose files into one library', () => {
    const libs = fromFileList([file('a.wav'), file('b.mp3')])
    expect(libs).toEqual([{ name: 'Imported samples', files: [expect.objectContaining({ path: 'a.wav' }), expect.objectContaining({ path: 'b.mp3' })] }])
  })
})
