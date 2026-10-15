import { useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { SAMPLE_DRAG_TYPE, assetForSample } from '../library/audio'
import { readMidiNotes } from '../midi/importMidi'
import { secondsPerBar } from '../model/grid'
import { beatSeconds, clipBeatRange, createNote, placeNotes } from '../model/midi'
import type { AssetMeta, DrumPad, MidiClip, Note, Track } from '../model/types'
import { ClipNameInput, PlaybackModeToggle } from '../pianoroll/shared'
import { btnClass, segClass, selectClass } from '../pianoroll/styles'
import { applyClipEdits, applyKitPreset, setClipNotes, setPad, setPadSample, setPadSamples } from '../state/actions'
import { loadLibrary, useLibraryStore } from '../library/store'
import { pickLibraryKit } from './libraryKit'
import { useProjectStore } from '../state/projectStore'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { toast } from '../ui/toast'
import { GeneratorDialog } from './GeneratorDialog'
import { DRUM_VOICES, KIT_PRESETS, VOICE_LABELS } from './kits'
import { useViewStore } from '../state/viewStore'
import { Menu } from '../ui/Menu'

const ROW_H = 20
const HEADER_W = 92
const STEP_SIZES = [
  { label: '1/8', beats: 1 / 2, width: 30 },
  { label: '1/16', beats: 1 / 4, width: 22 },
  { label: '1/32', beats: 1 / 8, width: 14 },
]
const VELOCITY = { normal: 0.8, accent: 1, soft: 0.45 }

const playPad = (trackId: string, pad: DrumPad, velocity = 0.9) => void engine.auditionNote(trackId, pad.note, 0.1, velocity)

/** Index of the step a note falls in, given the clip's first beat and the step size. */
const stepOf = (note: Note, from: number, step: number) => Math.floor((note.start - from) / step + 1e-6)

function PadGrid({ track, selected, onSelect }: { track: Track; selected: number; onSelect: (note: number) => void }) {
  const assets = useProjectStore((s) => s.project.assets)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  const assign = async (note: number, load: () => Promise<AssetMeta>) => {
    try {
      setPadSample(track.id, note, await load())
    } catch (err) {
      toast(`Could not load the sample: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    }
  }

  return (
    <div className="grid grid-cols-4 gap-1">
      {track.kit!.pads.map((pad) => (
        <button
          key={pad.note}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            onSelect(pad.note)
            playPad(track.id, pad)
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(SAMPLE_DRAG_TYPE) && !e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDropTarget(pad.note)
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => {
            e.preventDefault()
            setDropTarget(null)
            onSelect(pad.note)
            const sampleId = e.dataTransfer.getData(SAMPLE_DRAG_TYPE)
            const file = e.dataTransfer.files[0]
            if (sampleId) void assign(pad.note, () => assetForSample(sampleId))
            else if (file) void assign(pad.note, () => engine.assets.importFile(file, engine.context))
          }}
          className={`flex h-11 touch-none flex-col justify-center rounded-md border px-1.5 text-left active:bg-accent/30 ${
            pad.note === selected ? 'border-accent bg-accent/15' : 'border-line bg-surface-2 hover:border-text-dim'
          } ${dropTarget === pad.note ? 'ring-2 ring-accent' : ''}`}
          title={`${pad.name}: click to play, drop a one-shot here to use it`}
        >
          <span className="truncate text-[11px] font-semibold">{pad.name}</span>
          <span className="truncate text-[9px] text-text-dim">{pad.sample ? (assets[pad.sample.assetId]?.name ?? 'Sample') : 'Synth'}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * A step-sequencer row's name: click to select and hear it; the ▾ menu (or dropping a one-shot on
 * it) changes the row's sound without leaving the sequencer.
 */
function RowHeader({ track, pad, selected, onSelect }: { track: Track; pad: DrumPad; selected: boolean; onSelect: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)
  const load = async (get: () => Promise<AssetMeta>) => {
    try {
      setPadSample(track.id, pad.note, await get())
    } catch {
      toast('Could not read that file. Use a WAV or MP3 file.', 'error')
    }
  }
  return (
    <div
      className={`sticky left-0 z-10 flex shrink-0 items-center border-r border-b border-line text-[10px] ${
        selected ? 'bg-accent/15 text-text' : 'bg-surface text-text-dim hover:text-text'
      } ${dropping ? 'ring-2 ring-accent ring-inset' : ''}`}
      style={{ width: HEADER_W }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SAMPLE_DRAG_TYPE) && !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        onSelect()
        const sampleId = e.dataTransfer.getData(SAMPLE_DRAG_TYPE)
        const file = e.dataTransfer.files[0]
        if (sampleId) void load(() => assetForSample(sampleId))
        else if (file) void load(() => engine.assets.importFile(file, engine.context))
      }}
    >
      <button
        className="h-full min-w-0 flex-1 truncate px-1.5 text-left"
        onPointerDown={() => {
          onSelect()
          playPad(track.id, pad)
        }}
        title={`${pad.name}: click to hear it · drop a one-shot here to change its sound`}
      >
        {pad.name}
      </button>
      <Menu
        label={`${pad.name} sound`}
        className="h-full shrink-0 px-1 text-text-dim hover:text-text"
        items={[
          { label: 'Choose from the library…', onSelect: () => useViewStore.getState().setLibraryPick({ kind: 'pad', trackId: track.id, note: pad.note }) },
          { label: 'Load a file…', onSelect: () => fileRef.current?.click() },
          ...(pad.sample ? [{ label: 'Back to the synth sound', onSelect: () => setPadSample(track.id, pad.note, null) }] : []),
          ...DRUM_VOICES.map((voice) => ({
            label: `${!pad.sample && voice === pad.voice ? '✓ ' : ''}Synth: ${VOICE_LABELS[voice]}`,
            onSelect: () => {
              if (pad.sample) setPadSample(track.id, pad.note, null)
              setPad(track.id, pad.note, { voice })
              useProjectStore.getState().endGesture()
            },
          })),
        ]}
      >
        ▾
      </Menu>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void load(() => engine.assets.importFile(file, engine.context))
        }}
      />
    </div>
  )
}

function PadSettings({ track, pad }: { track: Track; pad: DrumPad }) {
  const endGesture = useProjectStore((s) => s.endGesture)
  const fileRef = useRef<HTMLInputElement>(null)
  const slider = (label: string, value: number, min: number, max: number, step: number, text: string, onChange: (v: number) => void, reset: number) => (
    <label className="grid grid-cols-[2.6rem_1fr_3rem] items-center gap-1.5 text-[10px] text-text-dim">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onDoubleClick={() => onChange(reset)}
        aria-label={`${pad.name} ${label.toLowerCase()}`}
        title="Double-click to reset"
      />
      <span className="text-right font-mono">{text}</span>
    </label>
  )
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-md border border-line p-2">
      <div className="flex items-center gap-1 text-[11px]">
        <span className="min-w-0 flex-1 truncate font-semibold">{pad.name}</span>
        <button className={btnClass} onClick={() => fileRef.current?.click()} title="Use a WAV or MP3 file on this pad">
          Load…
        </button>
        {pad.sample && (
          <button className={btnClass} onClick={() => setPadSample(track.id, pad.note, null)} title="Go back to the synthesized sound">
            Synth
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              setPadSample(track.id, pad.note, await engine.assets.importFile(file, engine.context))
            } catch {
              toast(`Could not read "${file.name}". Use a WAV or MP3 file.`, 'error')
            }
          }}
        />
      </div>
      {slider('Tune', pad.tune, -12, 12, 1, `${pad.tune > 0 ? '+' : ''}${pad.tune} st`, (v) => setPad(track.id, pad.note, { tune: v }), 0)}
      {!pad.sample &&
        slider('Decay', pad.decay, 0.25, 4, 0.05, `${Math.round(pad.decay * 100)}%`, (v) => setPad(track.id, pad.note, { decay: v }), 1)}
      {slider(
        'Level',
        pad.gain,
        0,
        2,
        0.01,
        pad.gain <= 0.001 ? '-inf' : `${(20 * Math.log10(pad.gain)).toFixed(1)}`,
        (v) => setPad(track.id, pad.note, { gain: v }),
        1,
      )}
      <label
        className="grid grid-cols-[2.6rem_1fr] items-center gap-1.5 text-[10px] text-text-dim"
        title="Pads in the same choke group cut each other off, like a closed hi-hat stopping an open one"
      >
        Choke
        <select
          value={pad.choke}
          onChange={(e) => setPad(track.id, pad.note, { choke: Number(e.target.value) })}
          className={selectClass}
          aria-label={`${pad.name} choke group`}
        >
          <option value={0}>None</option>
          {[1, 2, 3, 4].map((g) => (
            <option key={g} value={g}>
              Group {g}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function DrumEditor({ track, clip, color }: { track: Track; clip: MidiClip; color: string }) {
  const bpm = useProjectStore((s) => s.project.bpm)
  const ts = useProjectStore((s) => s.project.timeSignature)
  const [selectedPad, setSelectedPad] = useState(36)
  const [building, setBuilding] = useState(false)
  const [stepSize, setStepSize] = useState(STEP_SIZES[1])
  const [draft, setDraft] = useState<Note[] | null>(null)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const lineRef = useRef<HTMLDivElement>(null)
  const midiInput = useRef<HTMLInputElement>(null)

  const kit = track.kit!
  const pad = kit.pads.find((p) => p.note === selectedPad) ?? kit.pads[0]
  const notes = draft ?? clip.notes
  const spb = beatSeconds(bpm)
  const range = clipBeatRange(clip, bpm)
  const origin = clip.start - clip.offset
  const step = stepSize.beats
  const columns = Math.max(1, Math.ceil((range.to - range.from) / step - 1e-6))
  const stepsPerBeat = 1 / step
  const barBeats = (ts.beats * 4) / ts.unit
  const bars = Math.round((clip.duration / secondsPerBar(bpm, ts)) * 100) / 100

  // Which cells have hits: "note:step" → strongest velocity.
  const cells = new Map<string, number>()
  for (const n of notes) {
    if (n.start < range.from - 1e-6 || n.start >= range.to - 1e-6) continue
    const key = `${n.pitch}:${stepOf(n, range.from, step)}`
    cells.set(key, Math.max(cells.get(key) ?? 0, n.velocity))
  }

  usePlayheadFrame((t) => {
    const line = lineRef.current
    if (!line) return
    const beat = (t - origin) / spb - range.from
    line.style.display = beat < 0 || beat > range.to - range.from ? 'none' : ''
    line.style.transform = `translateX(${(beat / step) * stepSize.width}px)`
  })

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]')
    if (!el) return null
    const [note, col] = el.dataset.cell!.split(':').map(Number)
    return { note, col }
  }

  /** Click or drag over steps: adds hits on empty steps, or removes them if the first step had one. */
  const onCellDown = (e: React.PointerEvent) => {
    if (e.button === 1) return
    const start = cellAt(e.clientX, e.clientY)
    if (!start) return
    e.preventDefault()
    const startKey = `${start.note}:${start.col}`
    const original = clip.notes
    const inCell = (n: Note, note: number, col: number) =>
      n.pitch === note && n.start >= range.from - 1e-6 && n.start < range.to - 1e-6 && stepOf(n, range.from, step) === col

    // Alt+click cycles a hit's velocity: normal → accent → soft.
    if (e.altKey && cells.has(startKey)) {
      const v = cells.get(startKey)!
      const next = v >= 0.95 ? VELOCITY.soft : v <= 0.5 ? VELOCITY.normal : VELOCITY.accent
      setClipNotes(
        clip.id,
        original.map((n) => (inCell(n, start.note, start.col) ? { ...n, velocity: next } : n)),
        'Change step velocity',
      )
      return
    }

    const remove = e.button === 2 || cells.has(startKey)
    const velocity = e.shiftKey ? VELOCITY.accent : VELOCITY.normal
    const visited = new Set<string>()
    let next = original
    const apply = (c: { note: number; col: number } | null) => {
      if (!c || visited.has(`${c.note}:${c.col}`)) return
      visited.add(`${c.note}:${c.col}`)
      if (remove) {
        next = next.filter((n) => !inCell(n, c.note, c.col))
      } else if (!next.some((n) => inCell(n, c.note, c.col))) {
        next = [...next, createNote({ pitch: c.note, start: range.from + c.col * step, length: step, velocity })]
        const p = kit.pads.find((x) => x.note === c.note)
        if (p && visited.size === 1) playPad(track.id, p, velocity)
      }
      setDraft(next)
    }
    apply(start)
    // A fast drag skips cells between pointer events: fill in the steps along the same row.
    let last = start
    const move = (ev: PointerEvent) => {
      const c = cellAt(ev.clientX, ev.clientY)
      if (!c) return
      if (c.note === last.note) {
        const dir = Math.sign(c.col - last.col)
        for (let col = last.col + dir; col !== c.col; col += dir) apply({ note: c.note, col })
      }
      apply(c)
      last = c
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      if (next !== original) setClipNotes(clip.id, next, remove ? 'Remove steps' : 'Add steps')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const setBars = (n: number) =>
    applyClipEdits('Change clip length', [{ clipId: clip.id, trackId: track.id, fields: { duration: n * secondsPerBar(bpm, ts) } }])

  const importMidi = async (file: File) => {
    const imported = await readMidiNotes(file)
    if (!imported) return
    const known = new Set(kit.pads.map((p) => p.note))
    const usable = imported.filter((n) => known.has(n.pitch))
    if (!usable.length) return toast('That file has no notes on this kit’s pads (General MIDI drum notes).', 'error')
    setClipNotes(clip.id, [...clip.notes, ...placeNotes(usable, range.from)], 'Import MIDI')
  }

  const beatShade = (col: number) => Math.floor(col / stepsPerBeat) % 2 === 1

  const kitFromLibrary = async () => {
    setBuilding(true)
    try {
      if (!useLibraryStore.getState().loaded) await loadLibrary()
      const picks = pickLibraryKit(useLibraryStore.getState().samples)
      if (!picks.size) {
        toast('No drum one-shots found. Import a sample library with kicks, snares, hats… first (Library panel).', 'error')
        return
      }
      const samples = await Promise.all([...picks].map(async ([note, id]) => ({ note, asset: await assetForSample(id) })))
      setPadSamples(track.id, samples)
      toast(`Kit from library: ${samples.length} ${samples.length === 1 ? 'pad' : 'pads'} filled`)
    } catch (err) {
      toast(`Could not build the kit: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1 text-[11px]">
        <ClipNameInput clip={clip} />
        <label className="flex items-center gap-1 text-text-dim" title="Start from a kit preset (replaces the pads' sounds)">
          Kit
          <select value={kit.preset} onChange={(e) => applyKitPreset(track.id, e.target.value)} className={selectClass}>
            {kit.preset === 'custom' && <option value="custom">Custom</option>}
            {KIT_PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className={btnClass}
          disabled={building}
          onClick={() => void kitFromLibrary()}
          title="Build a new combination from the one-shots in your sample libraries (press again for another)"
        >
          {building ? 'Building…' : '🎲 Kit from library'}
        </button>
        <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Step size">
          {STEP_SIZES.map((s) => (
            <button key={s.label} className={segClass(s === stepSize)} aria-pressed={s === stepSize} onClick={() => setStepSize(s)}>
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-text-dim" title="Length of the clip">
          Bars
          <select value={Number.isInteger(bars) ? bars : ''} onChange={(e) => setBars(Number(e.target.value))} className={selectClass}>
            {!Number.isInteger(bars) && <option value="">{bars}</option>}
            {[1, 2, 4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <PlaybackModeToggle />
        <button className={`${btnClass} border-accent text-accent`} onClick={() => setGeneratorOpen(true)} title="Make a beat (and chords, melody, bass) for a genre">
          Generate…
        </button>
        <span className="flex-1" />
        <button className={btnClass} onClick={() => midiInput.current?.click()} title="Add the drum notes of a .mid file (General MIDI)">
          Import MIDI
        </button>
        <input
          ref={midiInput}
          type="file"
          accept=".mid,.midi,audio/midi"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importMidi(file)
          }}
        />
        <button className={btnClass} onClick={() => clip.notes.length && setClipNotes(clip.id, [], 'Clear pattern')} title="Remove every hit">
          Clear
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-line p-2">
          <PadGrid track={track} selected={pad.note} onSelect={setSelectedPad} />
          <PadSettings track={track} pad={pad} />
        </div>

        <div className="relative min-w-0 flex-1 overflow-auto" aria-label="Step sequencer">
          <div className="relative" style={{ width: HEADER_W + columns * stepSize.width }} onContextMenu={(e) => e.preventDefault()}>
            {kit.pads.map((p) => (
              <div key={p.note} className="flex" style={{ height: ROW_H }}>
                <RowHeader track={track} pad={p} selected={p.note === pad.note} onSelect={() => setSelectedPad(p.note)} />
                <div className="flex touch-none" onPointerDown={onCellDown} title="Click or drag to add steps · Shift accent · Alt+click changes velocity · right-click removes">
                  {Array.from({ length: columns }, (_, col) => {
                    const v = cells.get(`${p.note}:${col}`)
                    const barStart = (col * step) % barBeats < 1e-6
                    return (
                      <div
                        key={col}
                        data-cell={`${p.note}:${col}`}
                        className={`border-b border-line p-[2px] ${barStart ? 'border-l border-l-white/25' : 'border-l border-l-white/[0.06]'} ${
                          beatShade(col) ? 'bg-white/[0.03]' : ''
                        }`}
                        style={{ width: stepSize.width, height: ROW_H }}
                      >
                        {v !== undefined && (
                          <div
                            className="pointer-events-none h-full w-full rounded-sm"
                            style={{ background: color, opacity: 0.35 + 0.65 * v }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div
              ref={lineRef}
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent"
              style={{ left: HEADER_W }}
            />
          </div>
        </div>
      </div>
      {generatorOpen && <GeneratorDialog track={track} clip={clip} onClose={() => setGeneratorOpen(false)} />}
    </div>
  )
}
