import { LibraryPanel } from './library/LibraryPanel'
import { Mixer } from './mixer/Mixer'
import { useViewStore } from './state/viewStore'
import { Timeline } from './timeline/Timeline'
import { Toaster } from './ui/Toaster'
import { TransportBar } from './ui/TransportBar'
import { useShortcuts } from './ui/useShortcuts'

export default function App() {
  useShortcuts()
  const mixerOpen = useViewStore((s) => s.mixerOpen)
  const libraryOpen = useViewStore((s) => s.libraryOpen)
  return (
    <div className="flex h-full flex-col">
      <TransportBar />
      <div className="flex min-h-0 flex-1">
        {libraryOpen && <LibraryPanel />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Timeline />
          {mixerOpen && <Mixer />}
        </div>
      </div>
      <Toaster />
      <footer className="border-t border-line px-4 py-1.5 text-[11px] text-text-dim">
        Space play/pause · Ctrl+Z / Ctrl+Y undo/redo · Ctrl+wheel zoom · Alt free placement · Del delete · Ctrl+D duplicate ·
        Ctrl+C / Ctrl+V copy/paste · Ctrl+Shift+B add bus · Ctrl+S save · Ctrl+O projects · R record · K click · drag samples or WAV/MP3 onto a track
      </footer>
    </div>
  )
}
