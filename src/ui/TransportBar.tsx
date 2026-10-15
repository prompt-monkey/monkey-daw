import { useRef, useState } from 'react'
import { barBeatAt, formatTime } from '../model/grid'
import type { SnapMode, SyncMode } from '../model/types'
import { setLoop, setSnap, setSyncMode, setTimeSignature } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { stop, togglePlay, useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { RecordControls } from '../recording/RecordControls'
import { saveCurrent, useIsDirty, useSessionStore } from '../storage/session'
import { ExportDialog } from './ExportDialog'
import { ProjectsDialog } from './ProjectsDialog'
import { Menu } from './Menu'
import { NumberField } from './NumberField'
import { TempoControl } from './TempoControl'
import { setLitePreference, toggleFullscreen, useShellStore, type LitePreference } from './shell'

const SIGNATURES = ['4/4', '3/4', '2/4', '6/8']

function TimeReadout({ small = false }: { small?: boolean }) {
  const timeRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)

  usePlayheadFrame((t) => {
    const { bpm, timeSignature } = useProjectStore.getState().project
    const { bar, beat } = barBeatAt(t, bpm, timeSignature)
    if (timeRef.current) timeRef.current.textContent = formatTime(t)
    if (barRef.current) barRef.current.textContent = `${bar}.${beat}`
  })

  return (
    <div className={`flex items-baseline gap-3 rounded-lg border border-line bg-bg font-mono ${small ? 'px-2 py-1' : 'px-3 py-1.5'}`}>
      <span ref={timeRef} className={`${small ? 'text-base' : 'text-lg'} text-accent`} aria-label="Current time" />
      <span ref={barRef} className="text-sm text-text-dim" aria-label="Bar and beat" />
    </div>
  )
}

function ProjectControls({ menu }: { menu?: React.ReactNode }) {
  const name = useProjectStore((s) => s.project.name)
  const dirty = useIsDirty()
  const saving = useSessionStore((s) => s.saving)
  const savedId = useSessionStore((s) => s.savedId)
  const status = dirty ? 'Unsaved changes' : savedId ? 'Saved' : 'No changes'
  const projectsOpen = useViewStore((s) => s.projectsOpen)
  const setProjectsOpen = useViewStore((s) => s.setProjectsOpen)
  const button = 'rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] hover:bg-surface disabled:opacity-40'
  return (
    <div className="flex min-w-0 items-center gap-2">
      {menu ?? (
        <button className={button} onClick={() => setProjectsOpen(true)} title="Open, save and manage projects (Ctrl+O)">
          Projects
        </button>
      )}
      <span className="max-w-48 min-w-0 truncate text-sm font-semibold" title={name}>
        {name}
      </span>
      <span
        className={`size-2 shrink-0 rounded-full ${dirty ? 'bg-warn' : 'bg-transparent'}`}
        title={status}
        aria-label={status}
        role="status"
      />
      <button className={button} onClick={() => void saveCurrent()} disabled={saving} title="Save (Ctrl+S)">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {projectsOpen && <ProjectsDialog onClose={() => setProjectsOpen(false)} />}
    </div>
  )
}

export function TransportBar() {
  const playing = useTransportStore((s) => s.playing)
  const ts = useProjectStore((s) => s.project.timeSignature)
  const snap = useProjectStore((s) => s.project.snap)
  const syncMode = useProjectStore((s) => s.project.syncMode)
  const loop = useProjectStore((s) => s.project.loop)
  const canUndo = useProjectStore((s) => s.history.past.length > 0)
  const canRedo = useProjectStore((s) => s.history.future.length > 0)
  const undoLabel = useProjectStore((s) => s.history.past.at(-1)?.label)
  const redoLabel = useProjectStore((s) => s.history.future[0]?.label)
  const { undo, redo } = useProjectStore.getState()
  const [exportOpen, setExportOpen] = useState(false)
  const mixerOpen = useViewStore((s) => s.mixerOpen)
  const setMixerOpen = useViewStore((s) => s.setMixerOpen)
  const libraryOpen = useViewStore((s) => s.libraryOpen)
  const setLibraryOpen = useViewStore((s) => s.setLibraryOpen)
  const lyricsOpen = useViewStore((s) => s.lyricsOpen)
  const automationWrite = useViewStore((s) => s.automationWrite)
  const setAutomationWrite = useViewStore((s) => s.setAutomationWrite)
  const setLyricsOpen = useViewStore((s) => s.setLyricsOpen)
  const { fullscreen, litePreference, autoLite, narrow } = useShellStore()
  const liteLabel = (p: LitePreference) =>
    `${p === litePreference ? '✓' : '\u2003'} Lite mode: ${p === 'auto' ? `Auto (${autoLite ? 'on' : 'off'} now)` : p === 'on' ? 'On' : 'Off'}`

  const button = 'rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] hover:bg-surface disabled:opacity-40'
  const view = useViewStore.getState()
  const viewItems = [
    { label: 'Keyboard shortcuts (?)', onSelect: () => view.setShortcutsOpen(true) },
    { label: fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)', onSelect: () => void toggleFullscreen() },
    ...(['auto', 'on', 'off'] as const).map((p) => ({ label: liteLabel(p), onSelect: () => setLitePreference(p) })),
  ]
  const check = (on: boolean) => (on ? '✓ ' : '\u2003 ')
  // Phones: the panels, export and view options live in one menu, so the bar fits in three rows.
  const phoneMenu = narrow ? (
    <Menu
      label="Menu"
      className={button}
      items={[
        { label: 'Projects…', onSelect: () => view.setProjectsOpen(true) },
        { label: `${check(libraryOpen)}Library`, onSelect: () => setLibraryOpen(!libraryOpen) },
        { label: `${check(lyricsOpen)}Lyrics`, onSelect: () => setLyricsOpen(!lyricsOpen) },
        { label: `${check(mixerOpen)}Mixer`, onSelect: () => setMixerOpen(!mixerOpen) },
        { label: 'Export…', onSelect: () => setExportOpen(true) },
        ...viewItems,
      ]}
    >
      ☰
    </Menu>
  ) : undefined
  const undoRedo = (
    <>
      <button className={button} onClick={undo} disabled={!canUndo} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'} aria-label="Undo">
        ↶
      </button>
      <button className={button} onClick={redo} disabled={!canRedo} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Redo'} aria-label="Redo">
        ↷
      </button>
    </>
  )

  return (
    <header className={`flex flex-wrap items-center border-b border-line bg-surface ${narrow ? 'gap-1.5 px-2 py-1.5' : 'gap-x-2 gap-y-2 px-3 py-2'}`}>
      {narrow ? (
        <div className="flex w-full items-center gap-1.5">
          <ProjectControls menu={phoneMenu} />
          <span className="flex-1" />
          {undoRedo}
        </div>
      ) : (
        <ProjectControls />
      )}
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      <TimeReadout small={narrow} />
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
      <RecordControls />
      <button
        className={`${button} ${automationWrite ? 'border-danger text-danger' : ''}`}
        onClick={() => setAutomationWrite(!automationWrite)}
        aria-pressed={automationWrite}
        title="Write automation (W): while playing, moving a fader, pan or knob records the movement"
      >
        {automationWrite ? '● Write' : 'Write'}
      </button>

      <div className="flex items-center gap-2 text-sm text-text-dim" title="Tempo in BPM">
        {narrow ? '♩' : 'BPM'}
        <TempoControl className="w-16" />
        {!narrow && (
          <select
            value={syncMode}
            onChange={(e) => setSyncMode(e.target.value as SyncMode)}
            aria-label="Tempo sync mode"
            title="How audio clips synced to the tempo (loops with a BPM in their name) follow it: Stretch keeps their pitch, Resample changes speed and pitch together"
            className="rounded-md border border-line bg-bg px-1.5 py-1 text-xs text-text"
          >
            <option value="stretch">Stretch</option>
            <option value="resample">Resample</option>
          </select>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-text-dim" title="Time signature">
        {!narrow && 'Time'}
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

      <label className="flex items-center gap-2 text-sm text-text-dim" title="Snap to the grid">
        {!narrow && 'Snap'}
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
        {/* On phones the loop is set by dragging on the ruler. */}
        {!narrow && (['start', 'end'] as const).map((edge) => (
          <NumberField
            key={edge}
            label={`Loop ${edge} in seconds`}
            value={loop[edge]}
            min={0}
            step={0.5}
            onCommit={(v) => setLoop({ [edge]: Math.max(0, v) })}
            className="w-14"
          />
        ))}
        {!narrow && <span>s</span>}
      </div>

      {!narrow && (
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className={`${button} ${libraryOpen ? 'text-accent' : ''}`}
            onClick={() => setLibraryOpen(!libraryOpen)}
            aria-pressed={libraryOpen}
            title="Show or hide the sample library"
          >
            Library
          </button>
          <button
            className={`${button} ${lyricsOpen ? 'text-accent' : ''}`}
            onClick={() => setLyricsOpen(!lyricsOpen)}
            aria-pressed={lyricsOpen}
            title="Show or hide the lyrics"
          >
            Lyrics
          </button>
          <button className={button} onClick={() => setExportOpen(true)} title="Export the mix or stems as WAV or MP3">
            Export
          </button>
          <button
            className={`${button} ${mixerOpen ? 'text-accent' : ''}`}
            onClick={() => setMixerOpen(!mixerOpen)}
            aria-pressed={mixerOpen}
            title="Show or hide the mixer"
          >
            Mixer
          </button>
          <Menu label="View options" className={button} items={viewItems}>
            View
          </Menu>
          {undoRedo}
        </div>
      )}
    </header>
  )
}
