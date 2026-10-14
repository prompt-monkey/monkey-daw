import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type DawDatabase } from '../storage/db'
import { EMPTY_FILTER, buildTree, filterSamples, skipWrapperFolders } from './browse'
import { addLibrary, deleteLibrary, getSampleAudio, listLibraries, listSamples, renameLibrary, setSampleDuration } from './repo'

let db: DawDatabase
let count = 0
const freshDb = () => (db = openDatabase(`library-test-${++count}`))
afterEach(() => db?.delete())

const file = (text: string) => new Blob([text], { type: 'audio/wav' })
const files = [
  { path: 'Pack/Drums/Kick 10.wav', file: file('k10') },
  { path: 'Pack/Drums/Kick 2.wav', file: file('k2') },
  { path: 'Pack/Loops 6-8/Requinto 120bpm loop.wav', file: file('req') },
  { path: 'Pack/Loops 6-8/Tolo 120bpm loop.wav', file: file('tolo') },
  { path: 'Pack/readme.txt', file: new Blob(['hi']) },
]

describe('library repository', () => {
  it('imports audio files with detected metadata and skips other files', async () => {
    freshDb()
    const { library, added } = await addLibrary(db, 'Pack', files)
    expect(added).toBe(4)
    const samples = await listSamples(db)
    const req = samples.find((s) => s.name === 'Requinto 120bpm loop')!
    expect(req).toMatchObject({ libraryId: library.id, category: 'requinto', bpm: 120, signature: '6/8', duration: null })
    expect('blob' in req).toBe(false)
    expect(await (await getSampleAudio(db, req.id))!.text()).toBe('req')
  })

  it('renames and deletes libraries with their samples', async () => {
    freshDb()
    const { library } = await addLibrary(db, 'Pack', files)
    const other = await addLibrary(db, 'Other', [{ path: 'snare.wav', file: file('s') }])
    await renameLibrary(db, library.id, 'Corridos pack')
    expect((await listLibraries(db)).map((l) => l.name)).toEqual(['Corridos pack', 'Other'])
    await deleteLibrary(db, library.id)
    expect((await listSamples(db)).map((s) => s.libraryId)).toEqual([other.library.id])
  })

  it('remembers a sample duration once known', async () => {
    freshDb()
    await addLibrary(db, 'Pack', files)
    const [first] = await listSamples(db)
    await setSampleDuration(db, first.id, 0.42)
    expect((await listSamples(db)).find((s) => s.id === first.id)?.duration).toBe(0.42)
  })
})

describe('browsing', () => {
  it('builds a naturally sorted folder tree and skips wrapper folders', async () => {
    freshDb()
    await addLibrary(db, 'Pack', files)
    const tree = skipWrapperFolders(buildTree(await listSamples(db)))
    expect(tree.name).toBe('Pack')
    expect(tree.folders.map((f) => f.name)).toEqual(['Drums', 'Loops 6-8'])
    expect(tree.folders[0].samples.map((s) => s.name)).toEqual(['Kick 2', 'Kick 10'])
    expect(tree.folders[0].path).toBe('Pack/Drums')
  })

  it('filters by words, category, signature and kind', async () => {
    freshDb()
    await addLibrary(db, 'Pack', files)
    const samples = await listSamples(db)
    const names = (f: Partial<typeof EMPTY_FILTER>) => filterSamples(samples, { ...EMPTY_FILTER, ...f }).map((s) => s.name).sort()
    expect(names({ query: 'loop 120' })).toEqual(['Requinto 120bpm loop', 'Tolo 120bpm loop'])
    expect(names({ categories: ['kick'] })).toEqual(['Kick 10', 'Kick 2'])
    expect(names({ signatures: ['6/8'], categories: ['tololoche'] })).toEqual(['Tolo 120bpm loop'])
    expect(names({ kind: 'loop' })).toEqual(['Requinto 120bpm loop', 'Tolo 120bpm loop'])
    expect(names({ query: 'nothing here' })).toEqual([])
  })
})
