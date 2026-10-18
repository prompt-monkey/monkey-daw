import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { loadLibrary, useLibraryStore } from '../library/store'
import { isMidiClip } from '../model/types'
import { deleteClips, duplicateClips } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { useViewStore } from '../state/viewStore'
import { pickAudio, replaceWith } from './replaceAudio'

/**
 * The floating menu after tapping a clip on a touch screen: duplicate, swap the sample (audio) or
 * edit the notes (MIDI and drums), delete. A tap anywhere else closes it.
 */
export function ClipBubble() {
  const bubble = useViewStore((s) => s.clipBubble)
  // The clip's track, then the clip itself: both stable values, so the selectors don't loop.
  const track = useProjectStore((s) => (bubble ? s.project.tracks.find((t) => t.clips.some((c) => c.id === bubble.clipId)) : undefined))
  const clip = track?.clips.find((c) => c.id === bubble?.clipId)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bubble) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) useViewStore.getState().setClipBubble(null)
    }
    // Added after the tap that opened it has finished.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', close, true))
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('pointerdown', close, true)
    }
  }, [bubble])

  if (!bubble || !track || !clip) return null
  const trackId = track.id
  const view = useViewStore.getState()
  const done = (action: () => void | Promise<void>) => () => {
    view.setClipBubble(null)
    void action()
  }
  const button = 'rounded-md px-3 py-2 text-sm whitespace-nowrap transition-[background-color] duration-150 ease-out hover:bg-surface-3 active:bg-surface-3'
  // Above the finger, kept on screen.
  const left = Math.min(Math.max(8, bubble.x - 120), window.innerWidth - 248)
  const top = Math.max(8, bubble.y - 64)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`${clip.name} actions`}
      className="fixed z-[160] flex rounded-[10px] border border-transparent bg-surface-2 p-1 shadow-popover"
      style={{ left, top }}
    >
      <button role="menuitem" className={button} onClick={done(() => view.setSelection(duplicateClips([clip.id])))}>
        Duplicate
      </button>
      {isMidiClip(clip) ? (
        <button role="menuitem" className={button} onClick={done(() => view.openPianoRoll(trackId, clip.id))}>
          Edit
        </button>
      ) : (
        <button
          role="menuitem"
          className={button}
          onClick={done(async () => {
            // With no library imported, a file from the device instead.
            if (!useLibraryStore.getState().loaded) await loadLibrary()
            if (useLibraryStore.getState().samples.length) view.setLibraryPick({ kind: 'replace', clipId: clip.id })
            else pickAudio((file) => void replaceWith(clip.id, file))
          })}
        >
          Swap sample
        </button>
      )}
      <button
        role="menuitem"
        className={`${button} text-danger`}
        onClick={done(() => {
          deleteClips([clip.id])
          view.setSelection([])
        })}
      >
        Delete
      </button>
    </div>,
    document.body,
  )
}
