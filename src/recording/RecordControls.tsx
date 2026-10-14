import { useState } from 'react'
import { RecordingSettingsDialog } from './RecordingSettingsDialog'
import { recordingSupported } from './recorder'
import { toggleRecording } from './session'
import { useRecordingStore } from './store'

/** Record button, metronome toggle and recording settings, for the transport bar. */
export function RecordControls() {
  const status = useRecordingStore((s) => s.status)
  const metronome = useRecordingStore((s) => s.prefs.metronome)
  const setPrefs = useRecordingStore((s) => s.setPrefs)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const active = status === 'recording' || status === 'counting-in'
  const supported = recordingSupported()
  const button = 'rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] hover:bg-surface disabled:opacity-40'

  return (
    <div className="flex items-center gap-2">
      <button
        className={`rounded-md border px-2.5 py-1 text-[13px] font-semibold disabled:opacity-40 ${
          active ? 'animate-pulse border-danger bg-danger text-white' : 'border-line bg-surface-2 text-danger hover:bg-surface'
        }`}
        onClick={toggleRecording}
        disabled={!supported || status === 'saving' || status === 'opening'}
        title={supported ? 'Record on the armed track (R)' : 'Recording is not available in this browser'}
        aria-pressed={active}
      >
        {status === 'counting-in' ? '● Count-in' : active ? '■ Stop' : '● Rec'}
      </button>
      <button
        className={`${button} ${metronome ? 'text-accent' : ''}`}
        onClick={() => setPrefs({ metronome: !metronome })}
        aria-pressed={metronome}
        title="Metronome (K)"
      >
        Click
      </button>
      <button className={button} onClick={() => setSettingsOpen(true)} title="Recording settings" aria-label="Recording settings" disabled={!supported}>
        ⚙
      </button>
      {settingsOpen && <RecordingSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
