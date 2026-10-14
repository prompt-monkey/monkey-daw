import { useState } from 'react'
import { MAX_SOURCE_BPM, MIN_SOURCE_BPM, detectBpm } from '../model/tempo'
import { isMidiClip, type Clip, type Id } from '../model/types'
import { deleteClips, duplicateClips, renameClip, setClipSourceBpm } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { ContextMenu, type MenuItem } from '../ui/Menu'
import { PromptDialog } from '../ui/PromptDialog'

export interface ClipMenuState {
  clip: Clip
  trackId: Id
  x: number
  y: number
}

/** The right-click menu of a clip, with the dialogs it opens. */
export function ClipMenu({ menu, onClose }: { menu: ClipMenuState | null; onClose: () => void }) {
  const [prompt, setPrompt] = useState<{ kind: 'rename' | 'tempo'; clip: Clip } | null>(null)
  const bpm = useProjectStore((s) => s.project.bpm)

  const items = (clip: Clip, trackId: Id): MenuItem[] => {
    const list: MenuItem[] = []
    if (isMidiClip(clip)) {
      list.push({ label: 'Edit notes…', onSelect: () => useViewStore.getState().openPianoRoll(trackId, clip.id) })
    } else if (clip.sourceBpm) {
      list.push(
        { label: `Original tempo: ${clip.sourceBpm} BPM…`, onSelect: () => setPrompt({ kind: 'tempo', clip }) },
        { label: 'Stop syncing to the tempo', onSelect: () => setClipSourceBpm(clip.id, null) },
      )
    } else {
      list.push({ label: 'Sync to the project tempo…', onSelect: () => setPrompt({ kind: 'tempo', clip }) })
    }
    list.push(
      { label: 'Rename…', onSelect: () => setPrompt({ kind: 'rename', clip }) },
      {
        label: 'Duplicate',
        onSelect: () => useViewStore.getState().setSelection(duplicateClips(selectionWith(clip.id))),
      },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => {
          deleteClips(selectionWith(clip.id))
          useViewStore.getState().setSelection([])
        },
      },
    )
    return list
  }

  return (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.clip, menu.trackId)} onClose={onClose} />}
      {prompt?.kind === 'rename' && (
        <PromptDialog
          title="Rename clip"
          label="Name"
          initial={prompt.clip.name}
          submitLabel="Rename"
          onSubmit={(v) => (v.trim() ? renameClip(prompt.clip.id, v) : 'Type a name.')}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'tempo' && !isMidiClip(prompt.clip) && (
        <PromptDialog
          title="Sync to the project tempo"
          label="Tempo the audio was made at (BPM)"
          type="number"
          initial={String(prompt.clip.sourceBpm ?? detectBpm(prompt.clip.name) ?? bpm)}
          hint="The clip then plays at the project tempo and keeps its place in bars when the tempo changes. Stretch or Resample is chosen next to the BPM."
          submitLabel="Sync"
          onSubmit={(v) => {
            const n = Number(v)
            if (!(n >= MIN_SOURCE_BPM && n <= MAX_SOURCE_BPM)) return `Enter a tempo between ${MIN_SOURCE_BPM} and ${MAX_SOURCE_BPM}.`
            setClipSourceBpm(prompt.clip.id, n)
          }}
          onClose={() => setPrompt(null)}
        />
      )}
    </>
  )
}

/** The selected clips if the clip is among them, else just the clip. */
function selectionWith(clipId: Id): Id[] {
  const selection = useViewStore.getState().selection
  return selection.includes(clipId) ? selection : [clipId]
}
