import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { connectEngine } from './state/transport'
import { startSession } from './storage/session'
import './index.css'

connectEngine()
void startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
