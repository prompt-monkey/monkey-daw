import { TrackList } from './ui/TrackList'
import { TransportBar } from './ui/TransportBar'
import { useShortcuts } from './ui/useShortcuts'

export default function App() {
  useShortcuts()
  return (
    <div className="flex h-full flex-col">
      <TransportBar />
      <TrackList />
      <footer className="border-t border-line px-4 py-2 text-xs text-text-dim">
        Foundation dev panel · Space play/pause · Ctrl+Z undo · Ctrl+Y redo
      </footer>
    </div>
  )
}
