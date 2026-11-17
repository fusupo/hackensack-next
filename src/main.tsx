import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/style.css'
import './editor/index.css'
import App from './editor/App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
