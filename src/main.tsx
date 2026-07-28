import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const isWindows = /Windows/i.test(navigator.userAgent)
document.documentElement.classList.toggle('is-windows', isWindows)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
