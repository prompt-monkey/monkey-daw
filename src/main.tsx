import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { connectAutomationWrite } from './automation/write'
import { connectRecording } from './recording/session'
import { connectEngine } from './state/transport'
import { startSession } from './storage/session'
import { startShell, useShellStore } from './ui/shell'
import { useViewStore } from './state/viewStore'
import './index.css'

connectEngine()
startShell()
// Phones start with the timeline in view; the library opens as a drawer from the top bar.
if (useShellStore.getState().narrow) useViewStore.getState().setLibraryOpen(false)
connectRecording()
connectAutomationWrite()
void startSession()

// The editors and dialogs load on first use. Once the app has started and the browser is idle,
// fetch them in the background so opening one is instant (and works if the network drops).
const prefetch = () => {
  void import('./pianoroll/PianoRoll')
  void import('./effects/EffectsRack')
  void import('./pitch/PitchEditor')
  void import('./ui/ExportDialog')
  void import('./ui/ProjectsDialog')
  void import('./lyrics/LyricsPanel')
}
window.addEventListener('load', () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(prefetch, { timeout: 5000 }) : setTimeout(prefetch, 2000)))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
