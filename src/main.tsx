import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const isWindows = /Windows/i.test(navigator.userAgent)
document.documentElement.classList.toggle('is-windows', isWindows)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`./sw.js?v=${encodeURIComponent(__APP_VERSION__)}`, {
        updateViaCache: 'none',
      })
      .catch(() => {
        /* install as app still works without SW on some Edge builds */
      })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
