import { useState } from 'react'
import { MAX_PITCH_SHIFT, MAX_SOURCE_BPM, MIN_SOURCE_BPM, detectBpm } from '../model/tempo'
import { isMidiClip, type Clip, type Id } from '../model/types'
import { deleteClips, duplicateClips, renameClip, setClipSourceBpm, setClipsPitch, setClipsReversed } from '../state/actions'
import { toast } from '../ui/toast'
import { consolidate, convertToAudio } from './bounce'
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
  const [prompt, setPrompt] = useState<{ kind: 'rename' | 'tempo' | 'pitch'; clip: Clip } | null>(null)
  const bpm = useProjectStore((s) => s.project.bpm)

  const items = (clip: Clip, trackId: Id): MenuItem[] => {
    const list: MenuItem[] = []
    const ids = selectionWith(clip.id)
    if (isMidiClip(clip)) {
      list.push(
        { label: 'Edit notes…', onSelect: () => useViewStore.getState().openPianoRoll(trackId, clip.id) },
        { label: 'Convert to audio', onSelect: () => void run(() => convertToAudio(trackId, ownClips(trackId, ids), false), 'Converted to audio') },
        {
          label: 'Convert to audio with effects',
          onSelect: () => void run(() => convertToAudio(trackId, ownClips(trackId, ids), true), 'Converted to audio'),
        },
      )
    } else {
      list.push(
        { label: clip.pitchSource ? 'Edit pitch… (notes moved)' : 'Edit pitch…', onSelect: () => useViewStore.getState().openPitchEditor(clip.id) },
        { label: clip.reversed ? 'Play forwards' : 'Reverse', onSelect: () => setClipsReversed(ids, !clip.reversed) },
        { label: clip.pitch ? `Pitch: ${clip.pitch > 0 ? '+' : ''}${clip.pitch} semitones…` : 'Pitch…', onSelect: () => setPrompt({ kind: 'pitch', clip }) },
        {
          label: ids.length > 1 ? 'Consolidate selected clips' : 'Bounce (bake pitch, reverse, fades)',
          onSelect: () => void run(() => consolidate(ids), ids.length > 1 ? 'Clips consolidated' : 'Clip bounced'),
        },
      )
    }
    // Tempo sync is for audio clips only.
    if (!isMidiClip(clip) && clip.sourceBpm) {
      list.push(
        { label: `Original tempo: ${clip.sourceBpm} BPM…`, onSelect: () => setPrompt({ kind: 'tempo', clip }) },
        { label: 'Stop syncing to the tempo', onSelect: () => setClipSourceBpm(clip.id, null) },
      )
    } else if (!isMidiClip(clip)) {
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
      {prompt?.kind === 'pitch' && !isMidiClip(prompt.clip) && (
        <PromptDialog
          title="Clip pitch"
          label="Semitones (−24 to 24; 0 for none)"
          type="number"
          initial={String(prompt.clip.pitch ?? 0)}
          hint="Changes the pitch without changing the length. Use decimals for small tuning moves (0.5 = a quarter tone)."
          submitLabel="Set pitch"
          onSubmit={(v) => {
            const n = Number(v)
            if (!Number.isFinite(n) || Math.abs(n) > MAX_PITCH_SHIFT) return `Enter a number between −${MAX_PITCH_SHIFT} and ${MAX_PITCH_SHIFT}.`
            setClipsPitch(selectionWith(prompt.clip.id), n)
          }}
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

/** Runs a render job with a message when it's done (or fails). */
async function run(job: () => Promise<unknown>, done: string) {
  toast('Rendering…')
  try {
    await job()
    useViewStore.getState().setSelection([])
    toast(done)
  } catch (err) {
    toast(`Could not render: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
  }
}

/** The clips among `ids` that are on a track. */
function ownClips(trackId: Id, ids: Id[]): Id[] {
  const track = useProjectStore.getState().project.tracks.find((t) => t.id === trackId)
  return track?.clips.filter((c) => ids.includes(c.id)).map((c) => c.id) ?? []
}

/** The selected clips if the clip is among them, else just the clip. */
function selectionWith(clipId: Id): Id[] {
  const selection = useViewStore.getState().selection
  return selection.includes(clipId) ? selection : [clipId]
}
