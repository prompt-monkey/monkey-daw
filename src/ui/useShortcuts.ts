import { useEffect } from 'react'
import { useProjectStore } from '../state/projectStore'
import { togglePlay } from '../state/transport'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLInputElement) return !['range', 'checkbox', 'button'].includes(target.type)
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/** Global shortcuts: Space play/pause, Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const { undo, redo } = useProjectStore.getState()
      if (e.code === 'Space' && !mod) {
        e.preventDefault()
        togglePlay()
      } else if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
