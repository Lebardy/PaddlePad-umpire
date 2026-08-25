import { useEffect, useState } from 'react'
import Claim from './screens/Claim'
import Profile from './screens/Profile'
import { clearSession, getStoredPlayer, verifySession } from './lib/api'
import './App.css'

function App() {
  // Seeded from storage so a returning player isn't flashed the claim
  // screen while their token is being re-checked.
  const [player, setPlayer] = useState(getStoredPlayer)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    verifySession()
      .then((current) => {
        if (!cancelled) setPlayer(current)
      })
      .catch(() => {
        // Network failure, not a rejected token. Keep whatever session
        // was stored rather than signing someone out because their
        // signal dropped.
      })
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleSignOut() {
    clearSession()
    setPlayer(null)
  }

  if (!player && !checked) {
    return (
      <main className="app">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  return (
    <main className="app">
      {player ? (
        <Profile player={player} onSignOut={handleSignOut} />
      ) : (
        <Claim onClaimed={setPlayer} />
      )}
    </main>
  )
}

export default App
