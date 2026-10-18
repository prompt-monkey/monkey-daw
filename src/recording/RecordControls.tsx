import { lazy, Suspense, useState } from 'react'
import { Icon } from '../ui/Icon'
import { recordingSupported } from './recorder'
import { toggleRecording } from './session'
import { useRecordingStore } from './store'

const RecordingSettingsDialog = lazy(() => import('./RecordingSettingsDialog').then((m) => ({ default: m.RecordingSettingsDialog })))

/** The record button, for the transport bar. */
export function RecordButton() {
  const status = useRecordingStore((s) => s.status)
  const active = status === 'recording' || status === 'counting-in'
  const supported = recordingSupported()
  return (
    <button
      className={`btn btn-rec ${active ? '' : 'btn-danger'}`}
      onClick={toggleRecording}
      disabled={!supported || status === 'saving' || status === 'opening'}
      title={supported ? 'Record on the armed track (R)' : 'Recording is not available in this browser'}
      aria-pressed={active}
    >
      <Icon name="record" size={14} className={active ? 'animate-pulse' : ''} />
      {status === 'counting-in' ? 'Count-in' : active ? 'Stop' : 'Rec'}
    </button>
  )
}

/** Metronome toggle and recording settings, for the transport bar. */
export function RecordOptions({ compact = false }: { compact?: boolean }) {
  const metronome = useRecordingStore((s) => s.prefs.metronome)
  const setPrefs = useRecordingStore((s) => s.setPrefs)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const supported = recordingSupported()

  return (
    <>
      <button
        className={`btn ${compact ? 'btn-icon' : ''}`}
        onClick={() => setPrefs({ metronome: !metronome })}
        aria-pressed={metronome}
        aria-label="Metronome"
        title="Metronome (K)"
      >
        <Icon name="metronome" />
        {!compact && 'Click'}
      </button>
      <button
        className="btn btn-icon"
        onClick={() => setSettingsOpen(true)}
        title="Recording settings"
        aria-label="Recording settings"
        disabled={!supported}
      >
        <Icon name="sliders" />
      </button>
      {settingsOpen && (
        <Suspense fallback={null}>
          <RecordingSettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
