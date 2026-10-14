import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { INSTRUMENT_LABELS } from '../audio/instruments'
import { SAMPLE_DRAG_TYPE, assetForSample } from '../library/audio'
import { readMidiNotes } from '../midi/importMidi'
import {
  MAX_PITCH,
  MIN_NOTE_LENGTH,
  beatSeconds,
  clampPitch,
  clipBeatRange,
  createNote,
  isBlackKey,
  moveNotes,
  noteName,
  notesEnd,
  notesInRect,
  placeNotes,
  resizeNotes,
  snapBeat,
  transposeNotes,
} from '../model/midi'
import { isMidiClip, type Instrument, type MidiClip, type Note, type Track } from '../model/types'
import { renameClip, setClipNotes, setInstrument, setSamplerSample } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { playheadPosition, seek } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { trackColor } from '../timeline/colors'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { toast } from '../ui/toast'
import { GRID_STEPS, usePianoRollStore, type PianoRollTool } from './store'

const KEY_H = 14
const KEYS_W = 64
const RULER_H = 20
const GRID_H = (MAX_PITCH + 1) * KEY_H
const DRAG_THRESHOLD = 3

const yOf = (pitch: number) => (MAX_PITCH - pitch) * KEY_H
const pitchAtY = (y: number) => clampPitch(MAX_PITCH - Math.floor(y / KEY_H))

const TOOLS: { id: PianoRollTool; label: string; key: string; title: string }[] = [
  { id: 'draw', label: 'Draw', key: 'd', title: 'Draw notes: click to add, drag to set the length (D)' },
  { id: 'select', label: 'Select', key: 's', title: 'Select notes: drag a box, Shift adds (S)' },
  { id: 'erase', label: 'Erase', key: 'e', title: 'Erase notes: click or drag over them (E). Right-click erases with any tool' },
  { id: 'zoom', label: 'Zoom', key: 'z', title: 'Zoom: click to zoom in, Alt+click to zoom out (Z)' },
]

/** Window-level drag tracking, so a drag keeps working outside the grid. Escape cancels. */
function drag(start: PointerEvent, onMove: (ev: PointerEvent, moved: boolean) => void, onEnd: (ev: PointerEvent | null, moved: boolean) => void) {
  let moved = false
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - start.clientX) < DRAG_THRESHOLD && Math.abs(ev.clientY - start.clientY) < DRAG_THRESHOLD) return
    moved = true
    onMove(ev, true)
  }
  const finish = (ev: PointerEvent | null) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    onEnd(ev, moved)
  }
  const up = (ev: PointerEvent) => finish(ev)
  const cancel = () => finish(null)
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.stopPropagation()
    finish(null)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
}

const audition = (trackId: string, pitch: number) => void engine.auditionNote(trackId, pitch, 0.25)

/** The piano keys: click to hear a note, sweep across them for a glissando. */
const Keyboard = memo(function Keyboard({ trackId }: { trackId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pressed, setPressed] = useState<number | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ref.current) return
    e.preventDefault()
    const pitchAt = (clientY: number) => pitchAtY(clientY - ref.current!.getBoundingClientRect().top)
    let current = pitchAt(e.clientY)
    setPressed(current)
    audition(trackId, current)
    const move = (ev: PointerEvent) => {
      const pitch = pitchAt(ev.clientY)
      if (pitch === current) return
      current = pitch
      setPressed(pitch)
      audition(trackId, pitch)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPressed(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className="sticky left-0 z-20 shrink-0 cursor-pointer border-r border-line select-none"
      style={{ width: KEYS_W, height: GRID_H }}
      title="Click a key to hear it; drag across the keys for a glissando"
    >
      {Array.from({ length: MAX_PITCH + 1 }, (_, i) => {
        const pitch = MAX_PITCH - i
        const black = isBlackKey(pitch)
        return (
          <div
            key={pitch}
            className={`flex items-center justify-end border-b pr-1 text-[9px] leading-none ${
              pitch === pressed ? 'bg-accent text-accent-ink' : black ? 'bg-[#16181d] text-text-dim' : 'bg-[#d9dce3] text-[#30343c]'
            } ${pitch % 12 === 0 ? 'border-black/50' : 'border-black/15'}`}
            style={{ height: KEY_H }}
          >
            {pitch % 12 === 0 ? noteName(pitch) : ''}
          </div>
        )
      })}
    </div>
  )
})

/** Horizontal key rows behind the notes: darker for black keys, a line under each C. */
const Rows = memo(function Rows() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: MAX_PITCH + 1 }, (_, i) => {
        const pitch = MAX_PITCH - i
        return (
          <div
            key={pitch}
            className={`border-b ${isBlackKey(pitch) ? 'bg-black/25' : ''} ${pitch % 12 === 0 ? 'border-white/15' : 'border-white/[0.04]'}`}
            style={{ height: KEY_H }}
          />
        )
      })}
    </div>
  )
})

function gridLines(ppb: number, barBeats: number, beatBeats: number, step: number): React.CSSProperties {
  const line = (color: string) => `linear-gradient(to right, ${color} 1px, transparent 1px)`
  const layers = [{ image: line('var(--color-grid-bar)'), size: barBeats * ppb }]
  if (beatBeats * ppb >= 8) layers.push({ image: line('oklch(100% 0 0 / 0.07)'), size: beatBeats * ppb })
  if (step * ppb >= 8 && Math.abs(step - beatBeats) > 1e-9) layers.push({ image: line('oklch(100% 0 0 / 0.03)'), size: step * ppb })
  return {
    backgroundImage: layers.map((l) => l.image).join(', '),
    backgroundSize: layers.map((l) => `${l.size}px 100%`).join(', '),
  }
}

interface Marquee {
  b0: number
  b1: number
  p0: number
  p1: number
}

function Toolbar({ track, clip, notes }: { track: Track; clip: MidiClip; notes: Note[] }) {
  const { tool, grid, selection, velocity, setTool, setGrid, setVelocity } = usePianoRollStore()
  const patternMode = useViewStore((s) => s.patternMode)
  const setPatternMode = useViewStore((s) => s.setPatternMode)
  const sampleName = useProjectStore((s) => (track.instrument?.sample ? s.project.assets[track.instrument.sample.assetId]?.name : undefined))
  const endGesture = useProjectStore((s) => s.endGesture)
  const midiInput = useRef<HTMLInputElement>(null)
  const sampleInput = useRef<HTMLInputElement>(null)
  const instrument = track.instrument!
  const btn = 'rounded border border-line px-1.5 py-0.5 leading-4 hover:bg-surface-2'
  const seg = (active: boolean) => `px-1.5 py-0.5 leading-4 ${active ? 'bg-accent text-accent-ink' : 'hover:bg-surface-2'}`

  const selected = notes.filter((n) => selection.includes(n.id))
  const shiftOctave = (dir: 1 | -1) => {
    const target = selected.length ? selected : notes
    if (!target.length) return
    const moved = transposeNotes(target, 12 * dir)
    if (moved === target) return toast('Those notes would leave the keyboard.')
    const ids = new Set(target.map((n) => n.id))
    setClipNotes(clip.id, [...notes.filter((n) => !ids.has(n.id)), ...moved], dir > 0 ? 'Octave up' : 'Octave down')
  }

  const applyVelocity = (v: number) => {
    setVelocity(v)
    if (!selected.length) return
    const ids = new Set(selected.map((n) => n.id))
    setClipNotes(
      clip.id,
      notes.map((n) => (ids.has(n.id) ? { ...n, velocity: v } : n)),
      'Change velocity',
      `velocity:${clip.id}`,
    )
  }

  const loadSample = async (load: () => Promise<Parameters<typeof setSamplerSample>[1]>) => {
    try {
      setSamplerSample(track.id, await load(), instrument.sample?.root ?? 60)
    } catch (err) {
      toast(`Could not load the sample: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    }
  }

  const onSampleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const sampleId = e.dataTransfer.getData(SAMPLE_DRAG_TYPE)
    const file = e.dataTransfer.files[0]
    if (sampleId) void loadSample(() => assetForSample(sampleId))
    else if (file) void loadSample(() => engine.assets.importFile(file, engine.context))
  }

  const importMidi = async (file: File) => {
    const imported = await readMidiNotes(file)
    if (!imported) return
    const { from } = clipBeatRange(clip, useProjectStore.getState().project.bpm)
    const placed = placeNotes(imported, Math.max(0, from))
    setClipNotes(clip.id, [...notes, ...placed], 'Import MIDI')
    usePianoRollStore.getState().setSelection(placed.map((n) => n.id))
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1 text-[11px]">
      <input
        key={clip.name}
        defaultValue={clip.name}
        onBlur={(e) => e.target.value !== clip.name && renameClip(clip.id, e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="Clip name"
        className="w-28 truncate rounded bg-transparent px-1 font-semibold hover:bg-surface-2 focus:bg-bg"
      />
      <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button key={t.id} className={seg(tool === t.id)} aria-pressed={tool === t.id} title={t.title} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-text-dim" title="Grid: where notes snap (hold Alt for free placement)">
        Grid
        <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} className="rounded border border-line bg-bg px-1 py-0.5 text-text">
          {GRID_STEPS.map((g) => (
            <option key={g.label} value={g.beats}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Playback mode">
        <button
          className={seg(patternMode)}
          aria-pressed={patternMode}
          onClick={() => setPatternMode(true)}
          title="PAT: play only this clip, looping, while the piano roll is open"
        >
          PAT
        </button>
        <button className={seg(!patternMode)} aria-pressed={!patternMode} onClick={() => setPatternMode(false)} title="SONG: play the whole project">
          SONG
        </button>
      </div>
      <label className="flex items-center gap-1 text-text-dim" title="Velocity of new notes, and of the selected notes">
        Vel
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={selected.length === 1 ? selected[0].velocity : velocity}
          onChange={(e) => applyVelocity(Number(e.target.value))}
          onPointerUp={endGesture}
          onKeyUp={endGesture}
          className="w-16"
          aria-label="Velocity"
        />
        <span className="w-7 font-mono">{Math.round((selected.length === 1 ? selected[0].velocity : velocity) * 100)}</span>
      </label>
      <button className={btn} onClick={() => shiftOctave(-1)} title="Selected notes (or all) an octave down (Shift+↓)">
        Oct −
      </button>
      <button className={btn} onClick={() => shiftOctave(1)} title="Selected notes (or all) an octave up (Shift+↑)">
        Oct +
      </button>

      <span className="mx-1 h-4 w-px bg-line" />

      <label className="flex items-center gap-1 text-text-dim" title="The instrument this track plays its notes with">
        Instrument
        <select
          value={instrument.type}
          onChange={(e) => setInstrument(track.id, { type: e.target.value as Instrument['type'] })}
          className="rounded border border-line bg-bg px-1 py-0.5 text-text"
        >
          {Object.entries(INSTRUMENT_LABELS).map(([type, label]) => (
            <option key={type} value={type} disabled={type === 'sampler' && !instrument.sample}>
              {label}
              {type === 'sampler' && !instrument.sample ? ' (drop a sample)' : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        className={`max-w-40 truncate rounded border border-dashed px-1.5 py-0.5 leading-4 ${instrument.type === 'sampler' ? 'border-accent text-text' : 'border-line text-text-dim'} hover:bg-surface-2`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(SAMPLE_DRAG_TYPE) && !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={onSampleDrop}
        onClick={() => sampleInput.current?.click()}
        title="Drop a one-shot from the library (or a WAV/MP3) to play it across the keys"
      >
        {sampleName ? `Sample: ${sampleName}` : 'Drop a sample…'}
      </button>
      <input
        ref={sampleInput}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void loadSample(() => engine.assets.importFile(file, engine.context))
        }}
      />
      {instrument.type === 'sampler' && instrument.sample && (
        <label className="flex items-center gap-1 text-text-dim" title="The key at which the sample plays at its original pitch">
          Root
          <select
            value={instrument.sample.root}
            onChange={(e) => setInstrument(track.id, { sample: { ...instrument.sample!, root: Number(e.target.value) } }, 'Change root note')}
            className="rounded border border-line bg-bg px-1 py-0.5 text-text"
          >
            {Array.from({ length: 73 }, (_, i) => 24 + i).map((p) => (
              <option key={p} value={p}>
                {noteName(p)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1 text-text-dim" title="Glide: notes slide into each other, one at a time (0 = off)">
        Glide
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.005}
          value={instrument.glide}
          onChange={(e) => setInstrument(track.id, { glide: Number(e.target.value) }, 'Change glide')}
          onPointerUp={endGesture}
          onKeyUp={endGesture}
          className="w-16"
          aria-label="Glide"
        />
        <span className="w-10 font-mono">{instrument.glide ? `${Math.round(instrument.glide * 1000)} ms` : 'off'}</span>
      </label>

      <span className="flex-1" />
      <button className={btn} onClick={() => midiInput.current?.click()} title="Add the notes of a .mid file to this clip">
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
    </div>
  )
}

function Editor({ track, clip, color }: { track: Track; clip: MidiClip; color: string }) {
  const bpm = useProjectStore((s) => s.project.bpm)
  const ts = useProjectStore((s) => s.project.timeSignature)
  const { tool, grid, ppb, selection } = usePianoRollStore()
  const [draft, setDraft] = useState<Note[] | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const zoomAnchor = useRef<{ beat: number; px: number } | null>(null)

  const notes = draft ?? clip.notes
  const spb = beatSeconds(bpm)
  const range = clipBeatRange(clip, bpm)
  const origin = clip.start - clip.offset
  const barBeats = (ts.beats * 4) / ts.unit
  const beatBeats = 4 / ts.unit
  const beatsShown = Math.max(range.to + barBeats * 2, notesEnd(notes) + barBeats, (viewportWidth - KEYS_W) / ppb)
  const gridWidth = beatsShown * ppb
  const store = usePianoRollStore.getState

  const commit = (label: string, next: Note[]) => setClipNotes(clip.id, next, label)

  // Start a new clip scrolled to its notes (or middle C), and with nothing selected.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const pitches = clip.notes.map((n) => n.pitch)
    const center = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 60
    el.scrollTop = Math.max(0, yOf(center) - (el.clientHeight - RULER_H) / 2)
    el.scrollLeft = Math.max(0, range.from * store().ppb - 24)
    store().setSelection([])
    // Only when another clip opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    observer.observe(el)
    // Ctrl/Cmd + wheel zooms around the pointer.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const px = e.clientX - el.getBoundingClientRect().left - KEYS_W
      const current = store().ppb
      zoomAnchor.current = { beat: (el.scrollLeft + px) / current, px }
      store().setPpb(current * Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [store])

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const el = scrollerRef.current
    if (!anchor || !el) return
    zoomAnchor.current = null
    el.scrollLeft = Math.max(0, anchor.beat * ppb - anchor.px)
  }, [ppb])

  usePlayheadFrame((t) => {
    const line = lineRef.current
    if (!line) return
    const beat = (t - origin) / spb
    line.style.display = beat < 0 || beat > beatsShown ? 'none' : ''
    line.style.transform = `translateX(${beat * ppb}px)`
  })

  const beatAt = (clientX: number) => (clientX - gridRef.current!.getBoundingClientRect().left) / ppb
  const pitchAt = (clientY: number) => pitchAtY(clientY - gridRef.current!.getBoundingClientRect().top)

  const zoomAt = (clientX: number, factor: number) => {
    const el = scrollerRef.current!
    const px = clientX - el.getBoundingClientRect().left - KEYS_W
    zoomAnchor.current = { beat: (el.scrollLeft + px) / ppb, px }
    store().setPpb(ppb * factor)
  }

  /** Deletes the notes the pointer passes over (erase tool, or a right-button drag). */
  const eraseGesture = (e: React.PointerEvent) => {
    const removed = new Set<string>()
    const hit = (ev: PointerEvent | React.PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-note-id]')
      if (!el || removed.has(el.dataset.noteId!)) return
      removed.add(el.dataset.noteId!)
      setDraft(clip.notes.filter((n) => !removed.has(n.id)))
    }
    hit(e)
    drag(e.nativeEvent, hit, (ev) => {
      setDraft(null)
      if (!ev || !removed.size) return
      commit(removed.size > 1 ? 'Delete notes' : 'Delete note', clip.notes.filter((n) => !removed.has(n.id)))
      store().setSelection(store().selection.filter((id) => !removed.has(id)))
    })
  }

  const drawGesture = (e: React.PointerEvent) => {
    const beat = beatAt(e.clientX)
    const start = e.altKey ? beat : Math.floor(beat / grid) * grid
    const note = createNote({ pitch: pitchAt(e.clientY), start: Math.max(0, start), length: store().lastLength, velocity: store().velocity })
    let current = note
    setDraft([...clip.notes, note])
    store().setSelection([note.id])
    audition(track.id, note.pitch)
    drag(
      e.nativeEvent,
      (ev) => {
        const raw = beatAt(ev.clientX) - note.start
        const length = ev.altKey ? raw : snapBeat(raw, grid)
        current = { ...note, length: Math.max(ev.altKey ? MIN_NOTE_LENGTH : grid, length) }
        setDraft([...clip.notes, current])
      },
      (ev, moved) => {
        setDraft(null)
        if (!ev) {
          store().setSelection([])
          return
        }
        commit('Add note', [...clip.notes, current])
        if (moved) store().setLastLength(current.length)
      },
    )
  }

  const noteGesture = (e: React.PointerEvent, noteId: string, edge: boolean) => {
    const grabbed = clip.notes.find((n) => n.id === noteId)
    if (!grabbed) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (additive) {
      const sel = store().selection
      store().setSelection(sel.includes(noteId) ? sel.filter((id) => id !== noteId) : [...sel, noteId])
      return
    }
    if (!store().selection.includes(noteId)) store().setSelection([noteId])
    const ids = new Set(store().selection)
    const moving = clip.notes.filter((n) => ids.has(n.id))
    const rest = clip.notes.filter((n) => !ids.has(n.id))
    const b0 = beatAt(e.clientX)
    const p0 = pitchAt(e.clientY)
    let next = clip.notes
    let lastPitch = grabbed.pitch

    if (edge) {
      const end0 = grabbed.start + grabbed.length
      drag(
        e.nativeEvent,
        (ev) => {
          const rawEnd = end0 + beatAt(ev.clientX) - b0
          const end = ev.altKey ? rawEnd : snapBeat(rawEnd, grid)
          next = [...rest, ...resizeNotes(moving, end - end0)]
          setDraft(next)
        },
        (ev, moved) => {
          setDraft(null)
          if (!ev || !moved) return
          commit(moving.length > 1 ? 'Resize notes' : 'Resize note', next)
          const resized = next.find((n) => n.id === noteId)
          if (resized) store().setLastLength(resized.length)
        },
      )
      return
    }

    drag(
      e.nativeEvent,
      (ev) => {
        const rawStart = grabbed.start + beatAt(ev.clientX) - b0
        const target = ev.altKey ? Math.max(0, rawStart) : snapBeat(rawStart, grid)
        const moved = moveNotes(moving, target - grabbed.start, pitchAt(ev.clientY) - p0)
        const g = moved.find((n) => n.id === noteId)!
        if (g.pitch !== lastPitch) {
          lastPitch = g.pitch
          audition(track.id, g.pitch)
        }
        next = [...rest, ...moved]
        setDraft(next)
      },
      (ev, moved) => {
        setDraft(null)
        if (!ev) return
        if (!moved) {
          audition(track.id, grabbed.pitch)
          return
        }
        commit(moving.length > 1 ? 'Move notes' : 'Move note', next)
      },
    )
  }

  const marqueeGesture = (e: React.PointerEvent) => {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const initial = additive ? store().selection : []
    const b0 = beatAt(e.clientX)
    const p0 = pitchAt(e.clientY)
    drag(
      e.nativeEvent,
      (ev) => {
        const m = { b0, b1: beatAt(ev.clientX), p0, p1: pitchAt(ev.clientY) }
        setMarquee(m)
        store().setSelection([...new Set([...initial, ...notesInRect(clip.notes, m.b0, m.b1, m.p0, m.p1)])])
      },
      (ev, moved) => {
        setMarquee(null)
        if (ev && !moved && !additive) store().setSelection([])
      },
    )
  }

  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) return
    e.preventDefault()
    scrollerRef.current?.focus({ preventScroll: true })
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note-id]')
    if (e.button === 2 || tool === 'erase') return eraseGesture(e)
    if (tool === 'zoom') return zoomAt(e.clientX, e.altKey ? 1 / 1.5 : 1.5)
    if (noteEl) return noteGesture(e, noteEl.dataset.noteId!, Boolean((e.target as HTMLElement).closest('[data-edge]')))
    if (tool === 'draw') return drawGesture(e)
    marqueeGesture(e)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const { selection: sel, clipboard } = store()
    const ids = new Set(sel)
    const selected = clip.notes.filter((n) => ids.has(n.id))
    const others = clip.notes.filter((n) => !ids.has(n.id))
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if ((key === 'delete' || key === 'backspace') && selected.length) {
      handled()
      commit(selected.length > 1 ? 'Delete notes' : 'Delete note', others)
      store().setSelection([])
    } else if (mod && key === 'a') {
      handled()
      store().setSelection(clip.notes.map((n) => n.id))
    } else if (mod && (key === 'c' || key === 'x') && selected.length) {
      handled()
      store().setClipboard(selected)
      if (key === 'x') {
        commit('Cut notes', others)
        store().setSelection([])
      }
    } else if (mod && key === 'v' && clipboard.length) {
      handled()
      // At the playhead when it's over this clip, else where the notes were copied from.
      const beat = (playheadPosition() - origin) / spb
      const at = beat >= range.from && beat < range.to ? Math.floor(beat / grid + 1e-9) * grid : Math.min(...clipboard.map((n) => n.start))
      const pasted = placeNotes(clipboard, at)
      commit('Paste notes', [...clip.notes, ...pasted])
      store().setSelection(pasted.map((n) => n.id))
    } else if (mod && key === 'd' && selected.length) {
      handled()
      const first = Math.min(...selected.map((n) => n.start))
      const span = Math.ceil((notesEnd(selected) - first) / grid - 1e-9) * grid
      const copies = placeNotes(selected, first + span)
      commit('Duplicate notes', [...clip.notes, ...copies])
      store().setSelection(copies.map((n) => n.id))
    } else if ((key === 'arrowup' || key === 'arrowdown') && selected.length && !mod) {
      handled()
      const moved = transposeNotes(selected, (key === 'arrowup' ? 1 : -1) * (e.shiftKey ? 12 : 1))
      if (moved === selected) return
      commit(e.shiftKey ? (key === 'arrowup' ? 'Octave up' : 'Octave down') : 'Transpose notes', [...others, ...moved])
      if (moved.length === 1) audition(track.id, moved[0].pitch)
    } else if ((key === 'arrowleft' || key === 'arrowright') && selected.length && !mod) {
      handled()
      commit('Move notes', [...others, ...moveNotes(selected, key === 'arrowleft' ? -grid : grid, 0)])
    } else if (!mod && !e.altKey && TOOLS.some((t) => t.key === key)) {
      handled()
      store().setTool(TOOLS.find((t) => t.key === key)!.id)
    } else if (key === 'escape' && sel.length) {
      handled()
      store().setSelection([])
    }
  }

  const cursor = tool === 'zoom' ? 'cursor-zoom-in' : tool === 'erase' ? 'cursor-crosshair' : tool === 'draw' ? 'cursor-cell' : 'cursor-default'
  const bars = Math.ceil(beatsShown / barBeats)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar track={track} clip={clip} notes={notes} />
      <div ref={scrollerRef} tabIndex={0} onKeyDown={onKeyDown} className="relative min-h-0 flex-1 overflow-auto outline-none" aria-label="Piano roll">
        <div className="relative" style={{ width: KEYS_W + gridWidth, height: RULER_H + GRID_H }}>
          {/* Ruler: bars of the clip; click to move the playhead. */}
          <div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-10 shrink-0 border-r border-b border-line bg-surface" style={{ width: KEYS_W }} />
            <div
              className="relative shrink-0 cursor-pointer border-b border-line bg-surface"
              style={{ width: gridWidth }}
              onPointerDown={(e) => seek(origin + (Math.max(0, e.clientX - e.currentTarget.getBoundingClientRect().left) / ppb) * spb)}
              title="Click to move the playhead"
            >
              {Array.from({ length: bars }, (_, i) => (
                <span
                  key={i}
                  className="absolute top-0 h-full border-l border-line pl-1 text-[10px] leading-5 text-text-dim"
                  style={{ left: i * barBeats * ppb }}
                >
                  {i + 1}
                </span>
              ))}
              <div className="pointer-events-none absolute inset-y-0 bg-accent/20" style={{ left: range.from * ppb, width: (range.to - range.from) * ppb }} />
            </div>
          </div>

          <div className="flex">
            <Keyboard trackId={track.id} />
            <div
              ref={gridRef}
              className={`relative shrink-0 select-none ${cursor}`}
              style={{ width: gridWidth, height: GRID_H, ...gridLines(ppb, barBeats, beatBeats, grid) }}
              onPointerDown={onGridPointerDown}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Rows />
              {/* Outside the clip's span, notes don't play. */}
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/40" style={{ width: Math.max(0, range.from * ppb) }} />
              <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/40" style={{ left: range.to * ppb }} />
              <div className="pointer-events-none absolute inset-y-0 w-px bg-accent/60" style={{ left: range.to * ppb }} />

              {notes.map((n) => {
                const width = Math.max(3, n.length * ppb - 1)
                const selected = selection.includes(n.id)
                const outside = n.start >= range.to || n.start + n.length <= range.from
                return (
                  <div
                    key={n.id}
                    data-note-id={n.id}
                    className={`absolute overflow-hidden rounded-[3px] border ${selected ? 'border-white' : 'border-black/50'} ${
                      tool === 'erase' ? '' : 'cursor-move'
                    }`}
                    style={{
                      left: n.start * ppb,
                      top: yOf(n.pitch) + 1,
                      width,
                      height: KEY_H - 1,
                      opacity: outside ? 0.35 : 1,
                      background: `color-mix(in oklch, ${color} ${Math.round(45 + 55 * n.velocity)}%, ${selected ? 'white' : 'black'} ${selected ? 25 : 10}%)`,
                    }}
                    title={`${noteName(n.pitch)} · velocity ${Math.round(n.velocity * 100)}`}
                  >
                    {width > 30 && <span className="pointer-events-none pl-0.5 text-[9px] leading-3 text-black/70">{noteName(n.pitch)}</span>}
                    <div data-edge className={`absolute inset-y-0 right-0 cursor-ew-resize ${width > 12 ? 'w-1.5' : 'w-0.5'}`} />
                  </div>
                )
              })}

              {marquee && (
                <div
                  className="pointer-events-none absolute border border-accent bg-accent/10"
                  style={{
                    left: Math.min(marquee.b0, marquee.b1) * ppb,
                    width: Math.abs(marquee.b1 - marquee.b0) * ppb,
                    top: yOf(Math.max(marquee.p0, marquee.p1)),
                    height: (Math.abs(marquee.p1 - marquee.p0) + 1) * KEY_H,
                  }}
                />
              )}
              <div ref={lineRef} className="pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The piano roll for the MIDI clip opened from the timeline. */
export function PianoRoll() {
  const clipId = useViewStore((s) => s.pianoRoll?.clipId)
  // Look the clip up on every track: it may have been moved to another MIDI track.
  const tracks = useProjectStore((s) => s.project.tracks)
  const index = tracks.findIndex((t) => t.clips.some((c) => c.id === clipId))
  const track = tracks[index]
  const clip = track?.clips.find((c) => c.id === clipId)
  if (!track || !clip || !isMidiClip(clip) || !track.instrument) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-dim">
        Double-click a MIDI clip to edit its notes. Add a MIDI track with “+ MIDI track” under the tracks.
      </div>
    )
  }
  return <Editor track={track} clip={clip} color={trackColor(index)} />
}
