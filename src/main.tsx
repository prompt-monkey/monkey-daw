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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
