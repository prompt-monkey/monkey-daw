// Controls shared by the piano roll and the drum editor.

import type { MidiClip } from '../model/types'
import { renameClip } from '../state/actions'
import { useViewStore } from '../state/viewStore'
import { segClass } from './styles'

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

/** PAT plays only the open clip, looping; SONG plays the project. */
export function PlaybackModeToggle() {
  const patternMode = useViewStore((s) => s.patternMode)
  const setPatternMode = useViewStore((s) => s.setPatternMode)
  return (
    <div className="flex overflow-hidden rounded border border-line" role="group" aria-label="Playback mode">
      <button
        className={segClass(patternMode)}
        aria-pressed={patternMode}
        onClick={() => setPatternMode(true)}
        title="PAT: play only this clip, looping, while the editor is open"
      >
        PAT
      </button>
      <button className={segClass(!patternMode)} aria-pressed={!patternMode} onClick={() => setPatternMode(false)} title="SONG: play the whole project">
        SONG
      </button>
    </div>
  )
}
