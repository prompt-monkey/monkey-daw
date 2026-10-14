import { useRef, useState } from 'react'
import { barBeatAt, formatTime } from '../model/grid'
import type { SnapMode } from '../model/types'
import { setBpm, setLoop, setSnap, setTimeSignature } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { stop, togglePlay, useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { ExportDialog } from './ExportDialog'
import { NumberField } from './NumberField'

const SIGNATURES = ['4/4', '3/4', '2/4', '6/8']

function TimeReadout() {
  const timeRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)

  usePlayheadFrame((t) => {
    const { bpm, timeSignature } = useProjectStore.getState().project
    const { bar, beat } = barBeatAt(t, bpm, timeSignature)
    if (timeRef.current) timeRef.current.textContent = formatTime(t)
    if (barRef.current) barRef.current.textContent = `${bar}.${beat}`
  })

  return (
    <div className="flex items-baseline gap-3 rounded-lg border border-line bg-bg px-3 py-1.5 font-mono">
      <span ref={timeRef} className="text-lg text-accent" aria-label="Current time" />
      <span ref={barRef} className="text-sm text-text-dim" aria-label="Bar and beat" />
    </div>
  )
}

export function TransportBar() {
  const playing = useTransportStore((s) => s.playing)
  const bpm = useProjectStore((s) => s.project.bpm)
  const ts = useProjectStore((s) => s.project.timeSignature)
  const snap = useProjectStore((s) => s.project.snap)
  const loop = useProjectStore((s) => s.project.loop)
  const canUndo = useProjectStore((s) => s.history.past.length > 0)
  const canRedo = useProjectStore((s) => s.history.future.length > 0)
  const undoLabel = useProjectStore((s) => s.history.past.at(-1)?.label)
  const redoLabel = useProjectStore((s) => s.history.future[0]?.label)
  const { undo, redo, endGesture } = useProjectStore.getState()
  const [exportOpen, setExportOpen] = useState(false)
  const mixerOpen = useViewStore((s) => s.mixerOpen)
  const setMixerOpen = useViewStore((s) => s.setMixerOpen)

  const button = 'rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-40'

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
      <TimeReadout />
      <button
        className={`rounded-md px-4 py-1.5 text-sm font-semibold ${playing ? 'bg-warn text-accent-ink' : 'bg-accent text-accent-ink'}`}
        onClick={togglePlay}
        title="Play / pause (Space)"
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button className={button} onClick={stop} title="Stop and return to start">
        Stop
      </button>

      <div className="flex items-center gap-2 text-sm text-text-dim">
        BPM
        <NumberField
          label="Tempo in BPM"
          value={bpm}
          min={20}
          onCommit={(v) => {
            setBpm(v)
            endGesture()
          }}
          className="w-20"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-text-dim">
        Time
        <select
          value={`${ts.beats}/${ts.unit}`}
          onChange={(e) => {
            const [beats, unit] = e.target.value.split('/').map(Number)
            setTimeSignature({ beats, unit })
          }}
          className="rounded-md border border-line bg-bg px-2 py-1 text-text"
        >
          {SIGNATURES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-text-dim">
        Snap
        <select
          value={snap}
          onChange={(e) => setSnap(e.target.value as SnapMode)}
          className="rounded-md border border-line bg-bg px-2 py-1 text-text"
        >
          <option value="off">Off</option>
          <option value="bar">Bar</option>
          <option value="beat">Beat</option>
        </select>
      </label>

      <div className="flex items-center gap-2 text-sm text-text-dim">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={loop.enabled} onChange={(e) => setLoop({ enabled: e.target.checked })} />
          Loop
        </label>
        {(['start', 'end'] as const).map((edge) => (
          <NumberField
            key={edge}
            label={`Loop ${edge} in seconds`}
            value={loop[edge]}
            min={0}
            step={0.5}
            onCommit={(v) => setLoop({ [edge]: Math.max(0, v) })}
            className="w-16"
          />
        ))}
        <span>s</span>
      </div>

      <div className="ml-auto flex gap-2">
        <button className={button} onClick={() => setExportOpen(true)} title="Export the mix as a WAV file">
          Export
        </button>
        {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
        <button
          className={`${button} ${mixerOpen ? 'text-accent' : ''}`}
          onClick={() => setMixerOpen(!mixerOpen)}
          aria-pressed={mixerOpen}
          title="Show or hide the mixer"
        >
          Mixer
        </button>
        <button className={button} onClick={undo} disabled={!canUndo} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'}>
          Undo
        </button>
        <button className={button} onClick={redo} disabled={!canRedo} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Redo'}>
          Redo
        </button>
      </div>
    </header>
  )
}
