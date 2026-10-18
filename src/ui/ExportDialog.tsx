import { useState } from 'react'
import {
  downloadBlob,
  exportMix,
  exportRange,
  stemTracks,
  suggestedTail,
  type ExportResult,
  type ExportSettings,
} from '../audio/export'
import { formatTime } from '../model/grid'
import { formatDb } from '../model/levels'
import { renameProject } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { Dialog } from './Dialog'

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; result: ExportResult }
  | { kind: 'error'; message: string }

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project)
  const [name, setName] = useState(project.name)
  const tail = suggestedTail(project)
  const [settings, setSettings] = useState<ExportSettings>({
    scope: 'project',
    content: 'mix',
    format: 'wav',
    sampleRate: 44100,
    bitDepth: 16,
    mp3Bitrate: 320,
    tail,
  })
  const stems = stemTracks(project).length
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const running = status.kind === 'running'
  const range = exportRange(project, settings.scope, settings.tail)
  const loopAvailable = exportRange(project, 'loop') !== null

  const run = async () => {
    if (name.trim() && name.trim() !== project.name) renameProject(name)
    setStatus({ kind: 'running', progress: 0 })
    try {
      const current = useProjectStore.getState().project
      const result = await exportMix(current, settings, (progress) => setStatus({ kind: 'running', progress }))
      downloadBlob(result.blob, result.filename)
      setStatus({ kind: 'done', result })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Export failed.' })
    }
  }

  const field = 'field h-8 w-full text-sm'
  const label = 'flex flex-col gap-1 text-xs text-text-dim'

  return (
    <Dialog title="Export" onClose={onClose} dismissible={!running}>
      <div className="flex flex-col gap-4">
        <label className={label}>
          Project name (used for the file name)
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} disabled={running} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <fieldset className="flex flex-col gap-1.5 text-sm" disabled={running}>
            <legend className="mb-1 text-xs text-text-dim">What</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="content"
                checked={settings.content === 'mix'}
                onChange={() => setSettings({ ...settings, content: 'mix' })}
              />
              The mix
            </label>
            <label className={`flex items-center gap-2 ${stems ? '' : 'opacity-50'}`} title="One file per unmuted track, in a ZIP">
              <input
                type="radio"
                name="content"
                checked={settings.content === 'stems'}
                disabled={!stems}
                onChange={() => setSettings({ ...settings, content: 'stems' })}
              />
              Stems ({stems} {stems === 1 ? 'track' : 'tracks'}, ZIP)
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5 text-sm" disabled={running}>
            <legend className="mb-1 text-xs text-text-dim">Format</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="format" checked={settings.format === 'wav'} onChange={() => setSettings({ ...settings, format: 'wav' })} />
              WAV
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="format" checked={settings.format === 'mp3'} onChange={() => setSettings({ ...settings, format: 'mp3' })} />
              MP3
            </label>
          </fieldset>
        </div>

        <fieldset className="flex flex-col gap-1.5 text-sm" disabled={running}>
          <legend className="mb-1 text-xs text-text-dim">Range</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={settings.scope === 'project'}
              onChange={() => setSettings({ ...settings, scope: 'project' })}
            />
            Whole project
          </label>
          <label className={`flex items-center gap-2 ${loopAvailable ? '' : 'opacity-50'}`}>
            <input
              type="radio"
              name="scope"
              checked={settings.scope === 'loop'}
              disabled={!loopAvailable}
              onChange={() => setSettings({ ...settings, scope: 'loop' })}
            />
            Loop region{!loopAvailable && ' (turn on a loop first)'}
          </label>
        </fieldset>

        {settings.scope === 'project' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.tail > 0}
              disabled={running || tail === 0}
              onChange={(e) => setSettings({ ...settings, tail: e.target.checked ? Math.max(1, tail) : 0 })}
            />
            Include effect tails
            <span className="text-xs text-text-dim">
              {tail > 0 ? `(+${tail} s so reverb and delay can fade out)` : '(no reverb or delay in this project)'}
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Sample rate
            <select
              value={settings.sampleRate}
              onChange={(e) => setSettings({ ...settings, sampleRate: Number(e.target.value) as ExportSettings['sampleRate'] })}
              className={field}
              disabled={running}
            >
              <option value={44100}>44.1 kHz</option>
              <option value={48000}>48 kHz</option>
            </select>
          </label>
          {settings.format === 'wav' ? (
            <label className={label}>
              Bit depth
              <select
                value={settings.bitDepth}
                onChange={(e) => setSettings({ ...settings, bitDepth: Number(e.target.value) as ExportSettings['bitDepth'] })}
                className={field}
                disabled={running}
              >
                <option value={16}>16-bit (dithered)</option>
                <option value={24}>24-bit</option>
              </select>
            </label>
          ) : (
            <label className={label}>
              Quality
              <select
                value={settings.mp3Bitrate}
                onChange={(e) => setSettings({ ...settings, mp3Bitrate: Number(e.target.value) as ExportSettings['mp3Bitrate'] })}
                className={field}
                disabled={running}
              >
                <option value={320}>320 kbps (best)</option>
                <option value={256}>256 kbps</option>
                <option value={192}>192 kbps</option>
                <option value={128}>128 kbps (smallest)</option>
              </select>
            </label>
          )}
        </div>

        <p className="text-xs text-text-dim">
          {range
            ? `${settings.format.toUpperCase()}, stereo${settings.content === 'stems' ? `, ${stems} stems in a ZIP` : ''} · ${formatTime(range.start)} – ${formatTime(range.end)} (${(range.end - range.start).toFixed(1)} s)`
            : 'Nothing to export yet: add some clips first.'}
        </p>

        {status.kind === 'running' && (
          <div className="flex flex-col gap-1" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div className="h-full origin-left bg-accent transition-[scale] duration-150 ease-out motion-reduce:transition-none" style={{ scale: `${status.progress} 1` }} />
            </div>
            <span className="text-xs text-text-dim">
              {settings.content === 'stems' ? 'Rendering stems' : status.progress < 0.85 ? 'Rendering' : 'Encoding'}…{' '}
              {Math.round(status.progress * 100)}%
            </span>
          </div>
        )}
        {status.kind === 'done' && (
          <div className="flex flex-col gap-1 rounded-md bg-bg p-3 text-xs" role="status">
            <span>
              Saved <strong>{status.result.filename}</strong> · {formatSize(status.result.blob.size)}
              {status.result.files > 1 && ` · ${status.result.files} files`}
            </span>
            <span className="text-text-dim">
              {status.result.files > 1 ? 'Loudest stem peaks at' : 'Peak'} {formatDb(status.result.peak)} dBFS
            </span>
            {status.result.peak > 1 && (
              <span className="text-warn">
                {status.result.files > 1 ? 'A stem' : 'The mix'} goes above 0 dBFS and will distort. Lower the master or the loudest
                tracks and export again.
              </span>
            )}
            <button
              className="mt-1 self-start text-accent underline"
              onClick={() => downloadBlob(status.result.blob, status.result.filename)}
            >
              Download again
            </button>
          </div>
        )}
        {status.kind === 'error' && (
          <p className="text-xs text-danger" role="alert">
            {status.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn h-8 px-3 text-sm" onClick={onClose} disabled={running}>
            {status.kind === 'done' ? 'Close' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary h-8 px-4 text-sm"
            onClick={run}
            disabled={running || !range}
          >
            {running ? 'Exporting…' : status.kind === 'done' ? 'Export again' : `Export ${settings.format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
