import { useEffect } from 'react'
import { addBus, clipboardItems, deleteClips, duplicateClips, pasteClips } from '../state/actions'
import { useProjectStore } from '../state/projectStore'
import { playheadPosition, togglePlay } from '../state/transport'
import { useViewStore } from '../state/viewStore'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLInputElement) return !['range', 'checkbox', 'button'].includes(target.type)
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/**
 * Global shortcuts:
 * Space play/pause · Ctrl+Z undo · Ctrl+Y / Ctrl+Shift+Z redo · Delete/Backspace delete clips ·
 * Ctrl+D duplicate · Ctrl+C / Ctrl+V copy/paste at the playhead · Ctrl+A select all · Esc deselect ·
 * Ctrl+Shift+B add bus
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const { undo, redo, project } = useProjectStore.getState()
      const view = useViewStore.getState()
      const handled = () => e.preventDefault()

      if (e.code === 'Space' && !mod) {
        handled()
        togglePlay()
      } else if (mod && e.shiftKey && key === 'b') {
        handled()
        addBus()
        view.setMixerOpen(true)
      } else if (mod && key === 'z') {
        handled()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && key === 'y') {
        handled()
        redo()
      } else if ((key === 'delete' || key === 'backspace') && view.selection.length) {
        handled()
        deleteClips(view.selection)
        view.setSelection([])
      } else if (mod && key === 'd' && view.selection.length) {
        handled()
        view.setSelection(duplicateClips(view.selection))
      } else if (mod && key === 'c' && view.selection.length) {
        handled()
        view.setClipboard(clipboardItems(project, view.selection))
      } else if (mod && key === 'v' && view.clipboard.length) {
        handled()
        view.setSelection(pasteClips(view.clipboard, playheadPosition()))
      } else if (mod && key === 'a') {
        handled()
        view.setSelection(project.tracks.flatMap((t) => t.clips.map((c) => c.id)))
      } else if (key === 'escape') {
        view.setSelection([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
