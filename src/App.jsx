import { useEffect, useState } from 'react'
import Home from './screens/Home'
import SessionDetail from './screens/SessionDetail'
import MatchSetup from './screens/MatchSetup'
import LiveMatch from './screens/LiveMatch'
import Login from './screens/Login'
import Invites from './screens/Invites'
import { clearSession, fetchCurrentUmpire, getStoredUmpire } from './lib/api'
import SyncIndicator from './components/SyncIndicator'
import * as sync from './lib/sync'
import './App.css'

// Central view-router. There is no URL routing in this app (it's a
// single-page courtside tool) -- `view` is the entire navigation
// state, and each screen only gets the id it needs plus callbacks to
// move elsewhere.
function App() {
  const [view, setView] = useState({ name: 'home' })

  // Seeded from local storage so a returning umpire isn't flashed the
  // login screen while the token is being re-checked against the API.
  const [umpire, setUmpire] = useState(getStoredUmpire)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchCurrentUmpire()
      .then((current) => {
        if (!cancelled) setUmpire(current)
      })
      .catch(() => {
        // Network failure, not a rejected token. Keep whatever session
        // was stored -- signing an umpire out mid-match because the
        // court wifi dropped would be far worse than trusting a
        // possibly-stale token for a while.
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function openSession(sessionId) {
    setView({ name: 'session', sessionId })
  }

  function goHome() {
    setView({ name: 'home' })
  }

  function newMatch(sessionId) {
    setView({ name: 'matchSetup', sessionId })
  }

  function openMatch(matchId, sessionId) {
    setView({ name: 'match', matchId, sessionId })
  }

  // Sync starts only once there is a signed-in umpire, since every
  // endpoint needs a token. Pull failures are swallowed deliberately:
  // being offline at launch is normal courtside, and whatever is
  // already on the device stays usable.
  useEffect(() => {
    if (!umpire) return
    sync.init()
    sync.pullCore().catch(() => {})
  }, [umpire])

  function handleSignOut() {
    clearSession()
    setUmpire(null)
    setView({ name: 'home' })
  }

  const signedIn = Boolean(umpire)

  return (
    <div className="app-shell">
      <header className="app-header">
        <img src="/favicon.svg" alt="" />
        <h1>PaddlePad Umpire</h1>
        {signedIn && (
          <div className="header-right">
            <SyncIndicator />
            <button className="sign-out" onClick={handleSignOut}>
              {umpire.name} · Sign out
            </button>
          </div>
        )}
      </header>

      <main
        className={`app-main ${
          view.name === 'match' && signedIn ? 'app-main--full' : ''
        }`}
      >
        {!signedIn && !authChecked && <p className="empty">Checking sign-in…</p>}

        {!signedIn && authChecked && <Login onSignedIn={setUmpire} />}

        {signedIn && (
          <>
            {view.name === 'home' && (
              <Home
                onOpenSession={openSession}
                // Only admins can issue invites. Hiding the button is a
                // convenience, not the control -- the API refuses the
                // request regardless of what the app shows.
                onOpenInvites={
                  umpire.is_admin ? () => setView({ name: 'invites' }) : null
                }
              />
            )}
            {view.name === 'invites' && umpire.is_admin && (
              <Invites onBack={goHome} />
            )}
            {view.name === 'session' && (
              <SessionDetail
                sessionId={view.sessionId}
                onBack={goHome}
                onNewMatch={newMatch}
                onOpenMatch={(matchId) => openMatch(matchId, view.sessionId)}
              />
            )}
            {view.name === 'matchSetup' && (
              <MatchSetup
                sessionId={view.sessionId}
                onBack={() => openSession(view.sessionId)}
                onStart={(matchId) => openMatch(matchId, view.sessionId)}
              />
            )}
            {view.name === 'match' && (
              <LiveMatch
                matchId={view.matchId}
                onBack={() => openSession(view.sessionId)}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App
