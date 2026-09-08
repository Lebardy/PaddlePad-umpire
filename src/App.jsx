import { useEffect, useState } from 'react'
import Home from './screens/Home'
import SessionDetail from './screens/SessionDetail'
import MatchSetup from './screens/MatchSetup'
import LiveMatch from './screens/LiveMatch'
import Login from './screens/Login'
import Invites from './screens/Invites'
import Guide from './screens/Guide'
import Players from './screens/Players'
import Account from './screens/Account'
import { clearSession, fetchCurrentUmpire, getStoredUmpire } from './lib/api'
import SyncIndicator from './components/SyncIndicator'
import UpdateNotice from './components/UpdateNotice'
import * as sync from './lib/sync'
import { clearLocalData, migrateLegacyData } from './lib/storage'
import { pendingCount } from './lib/outbox'
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
    // Drop anything written before the server existed; those records
    // hold device-minted player ids that no longer resolve.
    migrateLegacyData()
    sync.init()
    sync.pullCore().catch(() => {})
  }, [umpire])

  // Signing out clears the local mirror as well as the token.
  //
  // Leaving it behind is not just untidy. A pull deliberately keeps
  // local records the server did not return, so anything deleted on the
  // server would come back on this device -- and anything still queued
  // would be pushed up again, undoing the deletion. It would also hand
  // the next person to use this device the club's whole match history.
  //
  // Unsynced work is the one thing worth stopping for, because it
  // exists nowhere else yet.
  function handleSignOut() {
    const unsynced = pendingCount()
    if (
      unsynced > 0 &&
      !confirm(
        `${unsynced} change${unsynced === 1 ? '' : 's'} on this device ` +
          "haven't reached the server yet, and signing out discards them. " +
          'Connect to the internet and wait for the sync to finish if you ' +
          'want to keep them.\n\nSign out anyway?',
      )
    ) {
      return
    }
    clearSession()
    clearLocalData()
    setUmpire(null)
    setView({ name: 'home' })
  }

  const signedIn = Boolean(umpire)

  return (
    <div className="app-shell">
      <header className="app-header">
        {/* Brand and controls sit in normal flow rather than the
            controls being absolutely positioned over a centred title.
            Absolute positioning meant that on a narrow phone the sync
            pill and umpire name simply overlapped the title. */}
        <div className="app-brand">
          <img src="/favicon.svg" alt="" />
          <h1>PaddlePad Umpire</h1>
        </div>
        {signedIn && (
          <div className="header-right">
            <UpdateNotice />
            <SyncIndicator />
            {/* Permanent, not a one-time tour. Most of what the guide
                explains is as useful on the second night as the first,
                and someone who dismissed a walkthrough would have no
                way back to it. */}
            <button
              className="help-btn"
              onClick={() => setView({ name: 'guide' })}
              aria-label="How this works"
              title="How this works"
            >
              ?
            </button>
            {/* The name and Sign out used to be one button, so the
                only thing tapping your own name could do was end the
                session. It opens the account screen now; signing out
                keeps its own button, and its own confirm when there is
                unsynced play. */}
            <button
              className="account-btn"
              onClick={() => setView({ name: 'account' })}
              title="Your account"
            >
              <span className="umpire-name">{umpire.name}</span>
            </button>
            <button className="sign-out" onClick={handleSignOut}>
              Sign out
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
                onOpenGuide={() => setView({ name: 'guide' })}
                umpire={umpire}
                // Only admins can issue invites. Hiding the button is a
                // convenience, not the control -- the API refuses the
                // request regardless of what the app shows.
                onOpenInvites={
                  umpire.is_admin ? () => setView({ name: 'invites' }) : null
                }
                onOpenPlayers={() => setView({ name: 'players' })}
              />
            )}
            {view.name === 'guide' && <Guide onBack={goHome} />}
            {view.name === 'players' && <Players onBack={goHome} />}

            {view.name === 'account' && (
              <Account
                umpire={umpire}
                onUmpireChange={setUmpire}
                onBack={goHome}
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
