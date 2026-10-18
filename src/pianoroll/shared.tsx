// Controls shared by the piano roll and the drum editor.

import type { MidiClip } from '../model/types'
import { renameClip, setClipSwing } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { rangeFill } from '../ui/rangeFill'

export function ClipNameInput({ clip }: { clip: MidiClip }) {
  return (
    <input
      key={clip.name}
      defaultValue={clip.name}
      onBlur={(e) => e.target.value !== clip.name && renameClip(clip.id, e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label="Clip name"
      className="w-28 truncate rounded bg-transparent px-1 font-semibold hover:bg-surface-2 focus:bg-bg"
    />
  )
}

/**
 * The clip's swing: every second sixteenth plays later, up to a triplet feel at 100%. The notes
 * stay on the grid; double-click goes back to straight.
 */
export function SwingControl({ clip }: { clip: MidiClip }) {
  const endGesture = useProjectStore((s) => s.endGesture)
  const swing = clip.swing ?? 0
  return (
    <label
      className="flex items-center gap-1 text-text-dim"
      title="Swing: every second sixteenth plays later, up to a triplet feel at 100% · double-click for straight"
    >
      Swing
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={swing}
        onChange={(e) => setClipSwing(clip.id, Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onDoubleClick={() => {
          setClipSwing(clip.id, 0)
          endGesture()
        }}
        aria-label="Swing"
        className="w-16"
        style={rangeFill(swing, 0, 100)}
      />
      <span className="w-8 font-mono text-text tabular-nums">{swing}%</span>
    </label>
  )
}

/** PAT plays only the open clip, looping; SONG plays the project. */
export function PlaybackModeToggle() {
  const patternMode = useViewStore((s) => s.patternMode)
  const setPatternMode = useViewStore((s) => s.setPatternMode)
  return (
    <div className="seg" role="group" aria-label="Playback mode">
      <button
        aria-pressed={patternMode}
        onClick={() => setPatternMode(true)}
        title="PAT: play only this clip, looping, while the editor is open"
      >
        PAT
      </button>
      <button aria-pressed={!patternMode} onClick={() => setPatternMode(false)} title="SONG: play the whole project">
        SONG
      </button>
    </div>
  )
}
