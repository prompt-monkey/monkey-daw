// Development panel for step 0: track strips plus a plain list of clips. The real timeline
// (drag, trim, waveforms) replaces the clip list in step 1.

import { useRef } from 'react'
import { engine } from '../audio/engine'
import { createTestTone } from '../dev/testTone'
import { formatTime } from '../model/grid'
import type { Track } from '../model/types'
import {
  addAudioClip,
  addTrack,
  removeClip,
  removeTrack,
  renameTrack,
  setMasterVolume,
  setTrackPan,
  setTrackVolume,
  toggleMute,
  toggleSolo,
} from '../state/actions'
import { useProjectStore } from '../state/projectStore'

const TONES = [220, 277.18, 329.63, 392, 440, 523.25]

const endOfTrack = (track: Track) => track.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0)

function TrackRow({ track, index }: { track: Track; index: number }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const endGesture = useProjectStore((s) => s.endGesture)
  const small = 'rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-2'

  const addTone = () => {
    const bpm = useProjectStore.getState().project.bpm
    const buffer = createTestTone(engine.context, TONES[index % TONES.length], bpm)
    const asset = engine.assets.add(`Test tone ${index + 1}`, buffer)
    addAudioClip(track.id, asset, endOfTrack(track))
  }

  const importFiles = async (files: FileList | null) => {
    let start = endOfTrack(track)
    for (const file of Array.from(files ?? [])) {
      try {
        const asset = await engine.assets.importFile(file, engine.context)
        addAudioClip(track.id, asset, start)
        start += asset.duration
      } catch {
        alert(`Could not read "${file.name}". Use a WAV or MP3 file.`)
      }
    }
  }

  return (
    <li className="grid grid-cols-[18rem_1fr] border-b border-line">
      <div className="flex flex-col gap-2 border-r border-line bg-surface p-3">
        <div className="flex items-center gap-2">
          <input
            defaultValue={track.name}
            key={track.name}
            onBlur={(e) => e.target.value !== track.name && renameTrack(track.id, e.target.value)}
            aria-label="Track name"
            className="min-w-0 flex-1 rounded bg-transparent px-1 font-semibold hover:bg-surface-2 focus:bg-bg"
          />
          <button
            onClick={() => toggleMute(track.id)}
            className={`${small} ${track.muted ? 'bg-warn text-accent-ink' : ''}`}
            aria-pressed={track.muted}
            title="Mute"
          >
            M
          </button>
          <button
            onClick={() => toggleSolo(track.id)}
            className={`${small} ${track.solo ? 'bg-accent text-accent-ink' : ''}`}
            aria-pressed={track.solo}
            title="Solo"
          >
            S
          </button>
          <button onClick={() => removeTrack(track.id)} className={`${small} hover:text-danger`} title="Delete track">
            ✕
          </button>
        </div>
        <label className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-2 text-xs text-text-dim">
          VOL
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.volume}
            onChange={(e) => setTrackVolume(track.id, Number(e.target.value))}
            onPointerUp={endGesture}
            onKeyUp={endGesture}
          />
          <span className="text-right font-mono">{Math.round(track.volume * 100)}%</span>
        </label>
        <label className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-2 text-xs text-text-dim">
          PAN
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={track.pan}
            onChange={(e) => setTrackPan(track.id, Number(e.target.value))}
            onPointerUp={endGesture}
            onKeyUp={endGesture}
            onDoubleClick={() => setTrackPan(track.id, 0)}
          />
          <span className="text-right font-mono">
            {track.pan === 0 ? 'C' : `${track.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan) * 100)}`}
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-3">
        {track.clips.map((clip) => (
          <span key={clip.id} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs">
            <span className="font-semibold">{clip.name}</span>
            <span className="font-mono text-text-dim">
              {formatTime(clip.start)} · {clip.duration.toFixed(2)}s
            </span>
            <button onClick={() => removeClip(track.id, clip.id)} className="text-text-dim hover:text-danger" title="Delete clip">
              ✕
            </button>
          </span>
        ))}
        <button onClick={addTone} className={small}>
          + Test tone
        </button>
        <button onClick={() => fileRef.current?.click()} className={small}>
          Import audio…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          multiple
          hidden
          onChange={(e) => {
            void importFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </li>
  )
}

export function TrackList() {
  const tracks = useProjectStore((s) => s.project.tracks)
  const master = useProjectStore((s) => s.project.master)
  const endGesture = useProjectStore((s) => s.endGesture)

  return (
    <section className="flex-1 overflow-auto">
      <ul>
        {tracks.map((track, i) => (
          <TrackRow key={track.id} track={track} index={i} />
        ))}
      </ul>
      <div className="flex items-center gap-6 p-3">
        <button onClick={() => addTrack()} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
          + Add track
        </button>
        <label className="flex items-center gap-2 text-sm text-text-dim">
          Master
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={master.volume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            onPointerUp={endGesture}
            onKeyUp={endGesture}
          />
          <span className="w-12 font-mono">{Math.round(master.volume * 100)}%</span>
        </label>
      </div>
    </section>
  )
}
