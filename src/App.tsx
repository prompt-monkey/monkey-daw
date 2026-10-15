import { Suspense, lazy } from 'react'
import { LibraryPanel } from './library/LibraryPanel'
import { BottomPanel } from './mixer/BottomPanel'
import { useViewStore } from './state/viewStore'
import { Timeline } from './timeline/Timeline'
import { useShellStore } from './ui/shell'
import { Toaster } from './ui/Toaster'
import { TransportBar } from './ui/TransportBar'
import { useShortcuts } from './ui/useShortcuts'

// Loaded the first time they open, so the app starts faster.
const LyricsPanel = lazy(() => import('./lyrics/LyricsPanel').then((m) => ({ default: m.LyricsPanel })))
const ShortcutsDialog = lazy(() => import('./ui/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })))

/** On phones, side panels slide over the timeline instead of taking its room. */
function Drawer({ side, onClose, children }: { side: 'left' | 'right'; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[150] flex bg-black/50" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex h-full max-w-[88vw] shadow-2xl ${side === 'right' ? 'ml-auto' : ''}`}>{children}</div>
    </div>
  )
}

export default function App() {
  useShortcuts()
  const mixerOpen = useViewStore((s) => s.mixerOpen)
  const libraryOpen = useViewStore((s) => s.libraryOpen)
  const lyricsOpen = useViewStore((s) => s.lyricsOpen)
  const shortcutsOpen = useViewStore((s) => s.shortcutsOpen)
  const narrow = useShellStore((s) => s.narrow)
  const view = useViewStore.getState()
  return (
    <div className="flex h-full flex-col">
      <TransportBar />
      <div className="flex min-h-0 flex-1">
        {libraryOpen &&
          (narrow ? (
            <Drawer side="left" onClose={() => view.setLibraryOpen(false)}>
              <LibraryPanel />
            </Drawer>
          ) : (
            <LibraryPanel />
          ))}
        <div className="flex min-w-0 flex-1 flex-col">
          <Timeline />
          {mixerOpen && <BottomPanel />}
        </div>
        {lyricsOpen && (
          <Suspense fallback={null}>
            {narrow ? (
              <Drawer side="right" onClose={() => view.setLyricsOpen(false)}>
                <LyricsPanel />
              </Drawer>
            ) : (
              <LyricsPanel />
            )}
          </Suspense>
        )}
      </div>
      <Toaster />
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsDialog onClose={() => view.setShortcutsOpen(false)} />
        </Suspense>
      )}
      {!narrow && (
        <footer className="flex gap-3 border-t border-line px-4 py-1.5 text-[11px] text-text-dim">
          <span>
            Space play/pause · Ctrl+Z undo · Ctrl+S save · drag samples, WAV/MP3 or MIDI files onto the timeline · right-click a
            clip for options
          </span>
          <button className="ml-auto text-accent hover:underline" onClick={() => view.setShortcutsOpen(true)}>
            All shortcuts (?)
          </button>
        </footer>
      )}
    </div>
  )
}
