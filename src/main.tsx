import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { connectEngine } from './state/transport'
import './index.css'

connectEngine()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
