import { lazy, Suspense, useRef, useState } from 'react'
import { barBeatAt, formatTime } from '../model/grid'
import type { SnapMode, SyncMode } from '../model/types'
import { setLoop, setSnap, setSyncMode, setTimeSignature } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { stop, togglePlay, useTransportStore } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { usePlayheadFrame } from '../timeline/usePlayheadFrame'
import { RecordButton, RecordOptions } from '../recording/RecordControls'
import { saveCurrent, useIsDirty, useSessionStore } from '../storage/session'
import { Icon } from './Icon'
import { Menu } from './Menu'
import { NumberField } from './NumberField'
import { TempoControl } from './TempoControl'
import { setLitePreference, toggleFullscreen, useShellStore, type LitePreference } from './shell'

// Dialogs load the first time they open, so the app starts faster.
const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })))
const ProjectsDialog = lazy(() => import('./ProjectsDialog').then((m) => ({ default: m.ProjectsDialog })))

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
    <div
      className={`flex shrink-0 items-baseline gap-3 rounded-lg border border-transparent bg-bg font-mono tabular-nums shadow-ring ${small ? 'px-2 py-0.5' : 'px-3 py-1'}`}
    >
      <span ref={timeRef} className={`${small ? 'text-base' : 'text-lg'} leading-6 text-accent`} aria-label="Current time" />
      <span ref={barRef} className="min-w-8 text-sm text-text-dim" aria-label="Bar and beat" />
    </div>
  )
}

/** Play and pause cross-fade in one place, so the button never changes size. */
function PlayButton() {
  const playing = useTransportStore((s) => s.playing)
  const layer =
    '[grid-area:1/1] transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:scale-100 motion-reduce:blur-[0px]'
  const shown = 'scale-100 opacity-100 blur-[0px]'
  const hidden = 'scale-[0.25] opacity-0 blur-[4px]'
  return (
    <button
      className="btn btn-primary btn-icon w-11"
      onClick={togglePlay}
      title="Play / pause (Space)"
      aria-label={playing ? 'Pause' : 'Play'}
    >
      <span className="grid place-items-center">
        <span className={`${layer} ${playing ? hidden : shown}`}>
          <Icon name="play" />
        </span>
        <span className={`${layer} ${playing ? shown : hidden}`}>
          <Icon name="pause" />
        </span>
      </span>
    </button>
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
  return (
    <div className="flex min-w-0 items-center gap-2">
      {menu ?? (
        <button className="btn" onClick={() => setProjectsOpen(true)} title="Open, save and manage projects (Ctrl+O)">
          <Icon name="folder" />
          Projects
        </button>
      )}
      <span className="max-w-56 min-w-0 truncate text-sm font-semibold" title={name}>
        {name}
      </span>
      <span
        className={`size-2 shrink-0 rounded-full ${dirty ? 'bg-warn' : 'bg-transparent'}`}
        title={status}
        aria-label={status}
        role="status"
      />
      <button className="btn" onClick={() => void saveCurrent()} disabled={saving} title="Save (Ctrl+S)">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {projectsOpen && (
        <Suspense fallback={null}>
          <ProjectsDialog onClose={() => setProjectsOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

export function TransportBar() {
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
    `${p === litePreference ? '✓' : ' '} Lite mode: ${p === 'auto' ? `Auto (${autoLite ? 'on' : 'off'} now)` : p === 'on' ? 'On' : 'Off'}`

  const view = useViewStore.getState()
  const viewItems = [
    { label: 'Keyboard shortcuts (?)', onSelect: () => view.setShortcutsOpen(true) },
    { label: fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)', onSelect: () => void toggleFullscreen() },
    ...(['auto', 'on', 'off'] as const).map((p) => ({ label: liteLabel(p), onSelect: () => setLitePreference(p) })),
  ]
  const check = (on: boolean) => (on ? '✓ ' : '  ')
  // Phones: the panels, export and view options live in one menu, so the bar fits in three rows.
  const phoneMenu = narrow ? (
    <Menu
      label="Menu"
      className="btn btn-icon"
      items={[
        { label: 'Projects…', onSelect: () => view.setProjectsOpen(true) },
        { label: `${check(libraryOpen)}Library`, onSelect: () => setLibraryOpen(!libraryOpen) },
        { label: `${check(lyricsOpen)}Lyrics`, onSelect: () => setLyricsOpen(!lyricsOpen) },
        { label: `${check(mixerOpen)}Mixer`, onSelect: () => setMixerOpen(!mixerOpen) },
        { label: 'Export…', onSelect: () => setExportOpen(true) },
        ...viewItems,
      ]}
    >
      <Icon name="menu" />
    </Menu>
  ) : undefined
  const undoRedo = (
    <div className="flex gap-1">
      <button
        className="btn btn-icon"
        onClick={undo}
        disabled={!canUndo}
        title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Undo'}
        aria-label="Undo"
      >
        <Icon name="undo" />
      </button>
      <button
        className="btn btn-icon"
        onClick={redo}
        disabled={!canRedo}
        title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Redo'}
        aria-label="Redo"
      >
        <Icon name="redo" />
      </button>
    </div>
  )
  const panelToggle = (label: string, icon: 'library' | 'lyrics' | 'mixer', open: boolean, set: (open: boolean) => void, title: string) => (
    <button className="btn" onClick={() => set(!open)} aria-pressed={open} title={title}>
      <Icon name={icon} />
      {label}
    </button>
  )

  const transport = (
    <div className="flex shrink-0 items-center gap-1">
      <button className="btn btn-icon" onClick={stop} title="Stop and return to start" aria-label="Stop">
        <Icon name="stop" />
      </button>
      <PlayButton />
      <RecordButton />
    </div>
  )

  const tempo = (
    <div className="flex shrink-0 items-center gap-1.5">
      {!narrow && <span className="label">BPM</span>}
      <TempoControl className={narrow ? 'w-14' : 'w-16'} />
      {!narrow && (
        <select
          value={syncMode}
          onChange={(e) => setSyncMode(e.target.value as SyncMode)}
          aria-label="Tempo sync mode"
          title="How audio clips synced to the tempo (loops with a BPM in their name) follow it: Stretch keeps their pitch, Resample changes speed and pitch together"
          className="field"
        >
          <option value="stretch">Stretch</option>
          <option value="resample">Resample</option>
        </select>
      )}
      <select
        value={`${ts.beats}/${ts.unit}`}
        onChange={(e) => {
          const [beats, unit] = e.target.value.split('/').map(Number)
          setTimeSignature({ beats, unit })
        }}
        aria-label="Time signature"
        title="Time signature"
        className="field font-mono"
      >
        {SIGNATURES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </div>
  )

  const loopControls = (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        className={`btn ${narrow ? 'btn-icon' : ''}`}
        onClick={() => setLoop({ enabled: !loop.enabled })}
        aria-pressed={loop.enabled}
        aria-label="Loop"
        title="Loop the region between the start and end (drag on the ruler to set it)"
      >
        <Icon name="loop" />
        {!narrow && 'Loop'}
      </button>
      {/* On phones the loop is set by dragging on the ruler. */}
      {!narrow && (
        <>
          <NumberField label="Loop start in seconds" value={loop.start} min={0} step={0.5} onCommit={(v) => setLoop({ start: Math.max(0, v) })} className="w-14" />
          <span className="text-text-dim">–</span>
          <NumberField label="Loop end in seconds" value={loop.end} min={0} step={0.5} onCommit={(v) => setLoop({ end: Math.max(0, v) })} className="w-14" />
          <span className="text-xs text-text-dim">s</span>
        </>
      )}
    </div>
  )

  const options = (
    <div className="flex shrink-0 items-center gap-1">
      <RecordOptions compact={narrow} />
      <button
        className={`btn btn-rec ${narrow ? 'btn-icon' : ''}`}
        onClick={() => setAutomationWrite(!automationWrite)}
        aria-pressed={automationWrite}
        aria-label="Write automation"
        title="Write automation (W): while playing, moving a fader, pan or knob records the movement"
      >
        <Icon name="pen" />
        {!narrow && 'Write'}
      </button>
    </div>
  )

  const snapControl = (
    <div className="flex shrink-0 items-center gap-1.5">
      {!narrow && <span className="label">Snap</span>}
      <select value={snap} onChange={(e) => setSnap(e.target.value as SnapMode)} aria-label="Snap to the grid" title="Snap to the grid" className="field">
        <option value="off">Off</option>
        <option value="bar">Bar</option>
        <option value="beat">Beat</option>
      </select>
    </div>
  )

  const exportDialog = exportOpen && (
    <Suspense fallback={null}>
      <ExportDialog onClose={() => setExportOpen(false)} />
    </Suspense>
  )

  if (narrow) {
    return (
      <header className="flex flex-col gap-1.5 border-b border-line bg-surface px-2 py-1.5">
        <div className="flex w-full items-center gap-1.5">
          <ProjectControls menu={phoneMenu} />
          <span className="flex-1" />
          {undoRedo}
        </div>
        <div className="flex items-center gap-1.5">
          {transport}
          <TimeReadout small />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tempo}
          {loopControls}
          {options}
          {snapControl}
        </div>
        {exportDialog}
      </header>
    )
  }

  return (
    <header className="flex flex-col border-b border-line bg-surface">
      {/* The project and the panels. */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <ProjectControls />
        <div className="divider" />
        {undoRedo}
        <span className="flex-1" />
        <div className="flex items-center gap-1">
          {panelToggle('Library', 'library', libraryOpen, setLibraryOpen, 'Show or hide the sample library')}
          {panelToggle('Lyrics', 'lyrics', lyricsOpen, setLyricsOpen, 'Show or hide the lyrics')}
          {panelToggle('Mixer', 'mixer', mixerOpen, setMixerOpen, 'Show or hide the mixer')}
        </div>
        <div className="divider" />
        <button className="btn" onClick={() => setExportOpen(true)} title="Export the mix or stems as WAV or MP3">
          <Icon name="export" />
          Export
        </button>
        <Menu label="View options" className="btn pe-2" items={viewItems}>
          View
          <Icon name="chevronDown" size={14} />
        </Menu>
      </div>
      {/* The transport, centered. */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3 py-2">
        {transport}
        <TimeReadout />
        <div className="divider" />
        {tempo}
        <div className="divider" />
        {loopControls}
        <div className="divider" />
        {options}
        <div className="divider" />
        {snapControl}
      </div>
      {exportDialog}
    </header>
  )
}
