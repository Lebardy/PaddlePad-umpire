import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initPwaUpdates } from './lib/pwa'
import { applyTheme, getThemeChoice, watchSystemTheme } from './lib/theme'

initPwaUpdates()

// The inline script in index.html has already painted the right colour;
// this re-applies the same choice through the module that owns it, and
// keeps following the phone while the choice is "system".
applyTheme(getThemeChoice())
watchSystemTheme(() => applyTheme(getThemeChoice()))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
