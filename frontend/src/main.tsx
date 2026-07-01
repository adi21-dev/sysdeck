import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}

let _deferredPrompt: Event | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  _deferredPrompt = e
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
