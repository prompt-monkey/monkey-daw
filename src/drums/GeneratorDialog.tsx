import { useState } from 'react'
import { create } from 'zustand'
import { secondsPerBar } from '../model/grid'
import { clipBeatRange, createNote } from '../model/midi'
import type { MidiClip, Track } from '../model/types'
import { applyPattern, setBpm, type GeneratedPart } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { Dialog } from '../ui/Dialog'
import { GENRES, KEY_NAMES, generatePattern, type GeneratedNote, type GeneratorOptions, type GenreId, type Scale } from './generator'

type PartKey = 'drums' | 'chords' | 'melody' | 'bass'

const PARTS: { key: PartKey; label: string; track?: string }[] = [
  { key: 'drums', label: 'Drums' },
  { key: 'chords', label: 'Chords', track: 'Chords' },
  { key: 'melody', label: 'Melody', track: 'Melody' },
  { key: 'bass', label: 'Bass', track: 'Bass' },
]

type Settings = Omit<GeneratorOptions, 'seed'> & { parts: PartKey[] }

// Kept outside the dialog, so reopening it picks up where you left off.
const useSettings = create<Settings>()(() => ({ genre: 'reggaeton', key: 9, scale: 'minor', parts: ['drums'] }))

const newSeed = () => Math.floor(Math.random() * 2 ** 31)

export function GeneratorDialog({ track, clip, onClose }: { track: Track; clip: MidiClip; onClose: () => void }) {
  const settings = useSettings()
  const [generated, setGenerated] = useState(0)
  const bpm = useProjectStore((s) => s.project.bpm)
  const genre = GENRES[settings.genre]
  const update = (changes: Partial<Settings>) => useSettings.setState(changes)
  const togglePart = (key: PartKey) =>
    update({ parts: settings.parts.includes(key) ? settings.parts.filter((p) => p !== key) : [...settings.parts, key] })
  const complete = PARTS.every((p) => settings.parts.includes(p.key))

  const generate = () => {
    const { project } = useProjectStore.getState()
    const ts = project.timeSignature
    const barBeats = (ts.beats * 4) / ts.unit
    const range = clipBeatRange(clip, project.bpm)
    const clipBeats = range.to - range.from
    const bars = Math.max(1, Math.ceil(clipBeats / barBeats - 1e-6))
    const pattern = generatePattern({ genre: settings.genre, key: settings.key, scale: settings.scale, seed: newSeed() }, bars, ts)
    // Drums go into this clip's beats; the other parts get their own clips starting with it.
    const within = (notes: GeneratedNote[], shift: number) =>
      notes.filter((n) => n.start < clipBeats - 1e-6).map((n) => createNote({ ...n, start: n.start + shift }))
    const parts: GeneratedPart[] = PARTS.filter((p) => p.track && settings.parts.includes(p.key)).map((p) => ({
      track: p.track!,
      instrument: p.key === 'bass' ? 'bass' : p.key === 'chords' ? genre.chords.instrument : genre.melody.instrument,
      notes: within(pattern[p.key], 0),
    }))
    applyPattern(clip.id, settings.parts.includes('drums') ? within(pattern.drums, range.from) : null, parts, `Generate ${genre.label}`, pattern.swing)
    setGenerated((n) => n + 1)
  }

  const tempoDiffers = Math.abs(bpm - genre.tempo) > 0.5
  const bars = Math.round((clip.duration / secondsPerBar(bpm, useProjectStore.getState().project.timeSignature)) * 100) / 100
  const field = 'flex flex-col gap-1 text-xs text-text-dim'
  const select = 'field h-8 text-sm'

  return (
    <Dialog title="Pattern generator" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <label className={`${field} col-span-3`}>
            Genre
            <select value={settings.genre} onChange={(e) => update({ genre: e.target.value as GenreId })} className={select}>
              {Object.entries(GENRES).map(([id, g]) => (
                <option key={id} value={id}>
                  {g.label} · around {g.tempo} BPM
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Key
            <select value={settings.key} onChange={(e) => update({ key: Number(e.target.value) })} className={select}>
              {KEY_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className={`${field} col-span-2`}>
            Scale
            <div className="seg">
              {(['major', 'minor'] as Scale[]).map((s) => (
                <button
                  key={s}
                  onClick={() => update({ scale: s })}
                  aria-pressed={settings.scale === s}
                  className="h-7 flex-1"
                >
                  {s === 'major' ? 'Major' : 'Minor'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-text-dim">What to write</legend>
          <div className="flex flex-wrap gap-2">
            {PARTS.map((p) => (
              <label key={p.key} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm">
                <input type="checkbox" checked={settings.parts.includes(p.key)} onChange={() => togglePart(p.key)} />
                {p.label}
              </label>
            ))}
            <button
              className="btn h-8"
              onClick={() => update({ parts: complete ? ['drums'] : PARTS.map((p) => p.key) })}
            >
              {complete ? 'Drums only' : 'Complete'}
            </button>
          </div>
          <p className="text-xs text-text-dim">
            Drums replace this clip’s pattern ({bars} {bars === 1 ? 'bar' : 'bars'}). Chords, melody and bass go on MIDI tracks of
            those names under “{track.name}”, replacing what they have in the same place.
          </p>
        </fieldset>

        {tempoDiffers && (
          <p className="flex items-center justify-between gap-2 text-xs text-text-dim">
            This genre usually runs around {genre.tempo} BPM (the project is at {bpm}).
            <button className="btn h-8" onClick={() => setBpm(genre.tempo)}>
              Use {genre.tempo} BPM
            </button>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn h-8 px-3 text-sm" onClick={onClose}>
            {generated ? 'Done' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary h-8 px-3 text-sm"
            disabled={!settings.parts.length}
            onClick={generate}
            title={generated ? 'Another take with the same settings (Ctrl+Z goes back)' : undefined}
          >
            {generated ? 'New variation' : 'Generate'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
