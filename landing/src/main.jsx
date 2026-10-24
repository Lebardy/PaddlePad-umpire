import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The inline script in index.html may already be sending this visit to
// the player app; rendering the page underneath would only flash.
if (!window.__forwarding) {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
