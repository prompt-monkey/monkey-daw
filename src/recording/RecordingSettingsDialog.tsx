import { useEffect } from 'react'
import { LevelMeter } from '../mixer/LevelMeter'
import { Dialog } from '../ui/Dialog'
import { NumberField } from '../ui/NumberField'
import { changeInputDevice, latencySeconds, openInput, readInputMeter, refreshDevices } from './session'
import { useRecordingStore, type RecordingPrefs } from './store'
import type { ChannelMode } from './take'
import { rangeFill } from '../ui/rangeFill'

const CHANNELS: { value: ChannelMode; label: string }[] = [
  { value: 'mono', label: 'Mono (both channels mixed)' },
  { value: 'left', label: 'Left / input 1 only' },
  { value: 'right', label: 'Right / input 2 only' },
  { value: 'stereo', label: 'Stereo' },
]

export function RecordingSettingsDialog({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs, devices, inputOpen } = useRecordingStore()
  // What "automatic" amounts to, from the browser's own latency figures (only meaningful when on).
  const autoLatency = prefs.latencyMs === null ? Math.round(latencySeconds() * 1000) : 0

  useEffect(() => {
    void refreshDevices()
  }, [])

  const field = 'field h-8 w-full text-sm'
  const label = 'flex flex-col gap-1 text-xs text-text-dim'
  const set = (patch: Partial<RecordingPrefs>) => setPrefs(patch)

  return (
    <Dialog title="Recording settings" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <label className={`${label} flex-1`}>
            Input
            <select value={prefs.deviceId ?? ''} onChange={(e) => void changeInputDevice(e.target.value || null)} className={field}>
              <option value="">Default input</option>
              {devices
                .filter((d) => d.id && d.id !== 'default')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
            </select>
          </label>
          <LevelMeter read={readInputMeter} orientation="horizontal" className="mb-2 h-3 w-24 rounded" />
        </div>
        {!inputOpen && (
          <button className="self-start text-xs text-accent underline" onClick={() => void openInput()}>
            Allow microphone access to list inputs and see the level
          </button>
        )}

        <label className={label}>
          Channels
          <select value={prefs.channelMode} onChange={(e) => set({ channelMode: e.target.value as ChannelMode })} className={field}>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Count-in
            <select
              value={prefs.countInBars}
              onChange={(e) => set({ countInBars: Number(e.target.value) as RecordingPrefs['countInBars'] })}
              className={field}
            >
              <option value={0}>Off</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </label>
          <label className={label}>
            Metronome volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={prefs.metronomeVolume}
              style={rangeFill(prefs.metronomeVolume, 0, 1)}
              onChange={(e) => set({ metronomeVolume: Number(e.target.value) })}
              className="mt-2"
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 text-xs">
          <legend className="mb-1 text-text-dim">Latency compensation</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.latencyMs === null} onChange={(e) => set({ latencyMs: e.target.checked ? null : autoLatency })} />
            Automatic {prefs.latencyMs === null && <span className="text-text-dim">({autoLatency} ms, as reported by the browser)</span>}
          </label>
          {prefs.latencyMs !== null && (
            <div className="flex items-center gap-2">
              <NumberField label="Latency in milliseconds" value={prefs.latencyMs} min={0} onCommit={(v) => set({ latencyMs: Math.max(0, Math.round(v)) })} className="w-24" />
              <span className="text-text-dim">ms. If takes land late, raise it; if early, lower it.</span>
            </div>
          )}
        </fieldset>

        <p className="text-[11px] text-text-dim">
          Echo cancellation, noise suppression and auto gain are turned off so recordings sound natural. Use headphones to
          keep the playback out of the microphone.
        </p>
        <div className="flex justify-end">
          <button className="btn btn-primary h-8 px-4 text-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  )
}
