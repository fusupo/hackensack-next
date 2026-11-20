import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/style.css'
import './editor/index.css'
import App from './editor/App.tsx'
import { devServerStorage } from './editor/devServerStorage.ts'

// The editor keeps its projects wherever this storage puts them: the dev
// server's project folders (server/plugin.ts). Another shell (#42) would hand
// it a different ProjectStorage here.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App storage={devServerStorage()} />
  </StrictMode>,
)
