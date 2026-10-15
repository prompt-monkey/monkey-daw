import { useEffect } from 'react'
import { addBus, clipboardItems, deleteClips, duplicateClips, pasteClips, setLoop, setSnap } from '../state/actions'
import { toggleRecording } from '../recording/session'
import { useRecordingStore } from '../recording/store'
import { useProjectStore } from '../state/projectStore'
import { saveCurrent } from '../storage/session'
import { playheadPosition, stop, togglePlay } from '../state/transport'
import { useViewStore } from '../state/viewStore'
import { toggleFullscreen } from './shell'
import type { SnapMode } from '../model/types'

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
 * Ctrl+Shift+B add bus · Ctrl+S save · Ctrl+O projects · R record · K metronome · W write
 * automation · F / Alt+F fullscreen · Home stop and back to the start · L loop · M magnet (snap) ·
 * B library · Alt+L lyrics · Ctrl + / Ctrl − zoom · ? shortcuts guide
 */
/** The snap the magnet goes back to when it is turned on again. */
let lastSnap: SnapMode = 'beat'

/** Turns the magnet off (clips move freely) or back on, to the snap it had before. */
export function toggleMagnet() {
  const { snap } = useProjectStore.getState().project
  if (snap === 'off') setSnap(lastSnap)
  else {
    lastSnap = snap
    setSnap('off')
  }
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      // Save works everywhere, even while typing, instead of the browser's "save page".
      if (mod && key === 's') {
        e.preventDefault()
        if (e.target instanceof HTMLElement) e.target.blur()
        void saveCurrent()
        return
      }
      if (isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return
      const { undo, redo, project } = useProjectStore.getState()
      const view = useViewStore.getState()
      const handled = () => e.preventDefault()

      if (e.code === 'Space' && !mod) {
        handled()
        togglePlay()
      } else if (key === 'home' && !mod) {
        handled()
        stop()
      } else if (e.altKey && !mod && e.code === 'KeyL') {
        handled()
        view.setLyricsOpen(!view.lyricsOpen)
      } else if (e.altKey && !mod && e.code === 'KeyF') {
        handled()
        void toggleFullscreen()
      } else if (e.altKey) {
        // Other Alt combinations belong to the browser and to gestures (Alt+drag, Alt+click).
        return
      } else if (!mod && key === 'l') {
        handled()
        setLoop({ enabled: !project.loop.enabled })
      } else if (!mod && key === 'm') {
        handled()
        toggleMagnet()
      } else if (!mod && key === 'b') {
        handled()
        view.setLibraryOpen(!view.libraryOpen)
      } else if (mod && (key === '=' || key === '+' || key === '-' || key === '_')) {
        handled()
        view.setPps(view.pps * (key === '-' || key === '_' ? 1 / 1.25 : 1.25))
      } else if (!mod && key === 'r') {
        handled()
        toggleRecording()
      } else if (!mod && e.key === '?') {
        handled()
        view.setShortcutsOpen(true)
      } else if (!mod && key === 'w') {
        handled()
        view.setAutomationWrite(!view.automationWrite)
      } else if (!mod && key === 'f') {
        handled()
        void toggleFullscreen()
      } else if (!mod && key === 'k') {
        handled()
        const rec = useRecordingStore.getState()
        rec.setPrefs({ metronome: !rec.prefs.metronome })
      } else if (mod && key === 'o') {
        handled()
        view.setProjectsOpen(true)
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
