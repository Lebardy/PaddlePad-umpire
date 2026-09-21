import { useEffect, useState } from 'react'
import Home from './screens/Home'
import SessionDetail from './screens/SessionDetail'
import MatchSetup from './screens/MatchSetup'
import LiveMatch from './screens/LiveMatch'
import Login from './screens/Login'
import Guide from './screens/Guide'
import Players from './screens/Players'
import Account from './screens/Account'
import { clearSession, fetchCurrentUmpire, getStoredUmpire, subscribeSessionEnded } from './lib/api'
import SyncIndicator from './components/SyncIndicator'
import UpdateNotice from './components/UpdateNotice'
import * as sync from './lib/sync'
import { clearLocalData, migrateLegacyData } from './lib/storage'
import { pendingCount } from './lib/outbox'
import './App.css'

/** "Jan Librando" -> "JL", for the account button. */
function initialsOf(name) {
  // Letters only, so "Third-shot check (staging)" is "TS", not "T(".
  const parts = String(name ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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
    // Undoes a stale authPaused from a previous session in this tab --
    // without this, one pause that has since been lifted would leave
    // every push silently dropped for the rest of the browser session,
    // even after a completely fresh sign-in.
    sync.resumeAfterSignIn()
    sync.pullCore().catch(() => {})
  }, [umpire])

  // A mid-session 401 -- most commonly a pause taking effect while
  // already signed in -- ends the session from inside api.js itself
  // (see subscribeSessionEnded there), not from a component, because it
  // can come from anywhere that calls apiFetch: sync's push loop, the
  // CSV export, any screen's own request. This mirrors that into the
  // umpire held here, the same way the launch check above does, so the
  // app actually lands back on Login instead of looking signed in with
  // a dead token.
  useEffect(() => subscribeSessionEnded(() => setUmpire(null)), [])

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
          <h1>
            PaddlePad <span className="app-brand-sub">Umpire</span>
          </h1>
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
            {/* Signing out lives on the account screen now, with its own
                confirm when there is unsynced play. In the header it sat
                one thumb-width from the sync pill, the control an umpire
                glances at most -- the worst neighbour for the one tap
                that can throw work away. */}
            <button
              className="account-btn"
              onClick={() => setView({ name: 'account' })}
              title="Your account"
              aria-label={
                umpire.facilityName
                  ? `Your account, ${umpire.name}, at ${umpire.facilityName}`
                  : `Your account, ${umpire.name}`
              }
            >
              <span className="account-initials" aria-hidden="true">
                {initialsOf(umpire.name)}
              </span>
              <span className="account-who">
                <span className="umpire-name">{umpire.name}</span>
                {umpire.facilityName && (
                  <span className="umpire-facility">{umpire.facilityName}</span>
                )}
              </span>
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
                onSignOut={handleSignOut}
              />
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
