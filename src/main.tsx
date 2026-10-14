import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { connectRecording } from './recording/session'
import { connectEngine } from './state/transport'
import { startSession } from './storage/session'
import './index.css'

connectEngine()
connectRecording()
void startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
