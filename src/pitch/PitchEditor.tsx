import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { isBlackKey, noteName } from '../model/midi'
import { clipRate } from '../model/tempo'
import { isMidiClip, type AudioClip, type PitchEdit } from '../model/types'
import { btnClass } from '../pianoroll/styles'
import { applyPitchEdits } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { toast } from '../ui/toast'
import type { PitchNote } from './analysis'
import { analyse, renderEdits, type PitchAnalysis } from './client'

const ROW = 14
const KEYS_W = 48
/** Notes of a clip that sit at the same place as an edit get that edit's shift. */
const SAME = 0.002

const shiftOf = (note: PitchNote, edits: PitchEdit[]) =>
  edits.find((e) => Math.abs(e.start - note.start) < SAME && Math.abs(e.end - note.end) < SAME)?.shift ?? 0

function Editor({ clip }: { clip: AudioClip }) {
  const bpm = useProjectStore((s) => s.project.bpm)
  const sourceId = clip.pitchSource?.assetId ?? clip.assetId
  const edits = clip.pitchSource?.edits ?? []
  const [analysis, setAnalysis] = useState<PitchAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pps, setPps] = useState(160)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<{ index: number; shift: number } | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)

  // The editor is remounted for another source (see the key below), so this runs once per source.
  useEffect(() => {
    let live = true
    analyse(sourceId)
      .then((a) => live && setAnalysis(a))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Analysis failed'))
    return () => {
      live = false
    }
  }, [sourceId])

  const rate = clipRate(clip, bpm)
  // The part of the recording the clip plays, in the recording's own seconds.
  const from = clip.offset
  const to = clip.offset + clip.duration * rate
  const notes = (analysis?.notes ?? []).filter((n) => n.end > from && n.start < to)
  const pitches = notes.map((n) => n.midi + shiftOf(n, edits))
  const top = Math.ceil(Math.max(...pitches, 64) + 4)
  const bottom = Math.floor(Math.min(...pitches, 52) - 4)
  const rows = top - bottom + 1
  const x = (t: number) => (t - from) * pps
  const y = (midi: number) => (top - midi) * ROW
  const width = Math.max(200, (to - from) * pps)

  usePlayheadFrame((t) => {
    const line = lineRef.current
    if (!line) return
    const source = (t - clip.start) * rate + clip.offset
    line.style.display = source < from || source > to ? 'none' : ''
    line.style.transform = `translateX(${x(source)}px)`
  })

  /** Renders the moves and switches the clip to the result. */
  const commit = async (next: PitchEdit[]) => {
    if (!analysis) return
    setBusy(true)
    try {
      if (!next.length) {
        applyPitchEdits(clip.id, sourceId, [], null)
        return
      }
      const buffer = await renderEdits(sourceId, analysis.track, next)
      const name = useProjectStore.getState().project.assets[sourceId]?.name ?? clip.name
      const asset = engine.assets.add(`${name} (tuned)`, buffer)
      applyPitchEdits(clip.id, sourceId, next, asset)
    } catch (err) {
      toast(`Could not apply the pitch change: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** The edits with one note's shift changed (0 removes its edit). */
  const withShift = (note: PitchNote, shift: number): PitchEdit[] => {
    const others = edits.filter((e) => !(Math.abs(e.start - note.start) < SAME && Math.abs(e.end - note.end) < SAME))
    return Math.abs(shift) < 0.005 ? others : [...others, { start: note.start, end: note.end, shift }]
  }

  const onNoteDown = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0 || busy) return
    e.preventDefault()
    const note = notes[index]
    const start = shiftOf(note, edits)
    const y0 = e.clientY
    let shift = start
    const move = (ev: PointerEvent) => {
      const raw = start + (y0 - ev.clientY) / ROW
      // Snaps so the note lands on a semitone; Alt moves it freely.
      shift = ev.altKey ? Math.round(raw * 20) / 20 : Math.round(note.midi + raw) - note.midi
      setDrag({ index, shift })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (Math.abs(shift - start) > 0.001) void commit(withShift(note, shift))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const snapAll = () => {
    let next = edits
    for (const n of notes) {
      const shift = Math.round(n.midi) - n.midi
      next = next.filter((e) => !(Math.abs(e.start - n.start) < SAME && Math.abs(e.end - n.end) < SAME))
      if (Math.abs(shift) >= 0.005) next = [...next, { start: n.start, end: n.end, shift }]
    }
    void commit(next)
  }

  if (error) return <div className="flex flex-1 items-center justify-center text-sm text-danger">{error}</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2 py-1 text-[11px]">
        <span className="font-semibold">{clip.name}</span>
        <span className="text-text-dim">
          {analysis ? `${notes.length} notes · drag a note up or down (Alt: freely), double-click to reset` : 'Finding the notes…'}
        </span>
        <span className="flex-1" />
        {busy && <span className="text-accent">Applying…</span>}
        <button className={btnClass} onClick={snapAll} disabled={!analysis || busy || !notes.length} title="Move every note onto its nearest semitone">
          Snap all to notes
        </button>
        <button className={btnClass} onClick={() => void commit([])} disabled={busy || !edits.length} title="Undo every pitch move on this clip">
          Reset all
        </button>
        <button className={btnClass} onClick={() => setPps(pps / 1.5)} title="Zoom out">
          −
        </button>
        <button className={btnClass} onClick={() => setPps(pps * 1.5)} title="Zoom in">
          +
        </button>
      </div>
      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative flex" style={{ width: KEYS_W + width, height: rows * ROW }}>
          <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-surface" style={{ width: KEYS_W }}>
            {Array.from({ length: rows }, (_, i) => {
              const midi = top - i
              return (
                <div
                  key={midi}
                  className={`flex items-center justify-end border-b pr-1 text-[9px] ${isBlackKey(midi) ? 'bg-black/30 text-text-dim' : 'text-text-dim'} ${midi % 12 === 0 ? 'border-white/20' : 'border-white/5'}`}
                  style={{ height: ROW }}
                >
                  {noteName(midi)}
                </div>
              )
            })}
          </div>
          <div className="relative shrink-0" style={{ width }}>
            {Array.from({ length: rows }, (_, i) => (
              <div
                key={i}
                className={`pointer-events-none border-b ${isBlackKey(top - i) ? 'bg-black/20' : ''} border-white/5`}
                style={{ height: ROW }}
              />
            ))}
            {analysis && (
              <svg className="pointer-events-none absolute inset-0" width={width} height={rows * ROW}>
                <polyline
                  fill="none"
                  stroke="var(--color-text-dim)"
                  strokeWidth={1}
                  points={contour(analysis, from, to, x, y)}
                />
              </svg>
            )}
            {notes.map((n, i) => {
              const shift = drag?.index === i ? drag.shift : shiftOf(n, edits)
              const moved = Math.abs(shift) > 0.001
              return (
                <div key={`${n.start}`}>
                  {moved && (
                    <div
                      className="pointer-events-none absolute rounded-sm border border-dashed border-text-dim/50"
                      style={{ left: x(n.start), width: Math.max(4, x(n.end) - x(n.start)), top: y(n.midi) - ROW / 2 + 1, height: ROW - 2 }}
                    />
                  )}
                  <div
                    onPointerDown={(e) => onNoteDown(e, i)}
                    onDoubleClick={() => moved && void commit(withShift(n, 0))}
                    className={`absolute cursor-ns-resize touch-none rounded-md border ${moved ? 'border-white bg-accent/80' : 'border-accent/60 bg-accent/40'}`}
                    style={{ left: x(n.start), width: Math.max(4, x(n.end) - x(n.start)), top: y(n.midi + shift) - ROW / 2 + 1, height: ROW - 2 }}
                    title={`${noteName(Math.round(n.midi))} ${Math.round((n.midi - Math.round(n.midi)) * 100)}¢${moved ? ` → ${shift > 0 ? '+' : ''}${shift.toFixed(2)} st` : ''}`}
                  />
                </div>
              )
            })}
            <div ref={lineRef} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accent" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The detected pitch as polyline points, with gaps bridged only between nearby frames. */
function contour(a: PitchAnalysis, from: number, to: number, x: (t: number) => number, y: (m: number) => number): string {
  const points: string[] = []
  const centre = a.track.hop * 4
  for (let f = 0; f < a.track.midi.length; f += 2) {
    const t = f * a.track.hop + centre
    const m = a.track.midi[f]
    if (t < from || t > to || Number.isNaN(m)) continue
    points.push(`${x(t).toFixed(1)},${y(m).toFixed(1)}`)
  }
  return points.join(' ')
}

/** The pitch editor for the audio clip opened from the timeline. */
export function PitchEditor() {
  const clipId = useViewStore((s) => s.pitchClip)
  const clip = useProjectStore((s) => {
    for (const t of s.project.tracks) for (const c of t.clips) if (c.id === clipId && !isMidiClip(c)) return c
    return null
  })
  if (!clip) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-dim">
        Right-click an audio clip (a sung or played melody) and choose “Edit pitch…”.
      </div>
    )
  }
  return <Editor key={`${clip.id}:${clip.pitchSource?.assetId ?? clip.assetId}`} clip={clip} />
}
