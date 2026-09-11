import { useEffect } from 'react'
import SignIn from './screens/SignIn'
import Overview from './screens/Overview'
import Matches from './screens/Matches'
import MatchDetail from './screens/MatchDetail'
import People from './screens/People'
import PersonDetail from './screens/PersonDetail'
import Rating from './screens/Rating'
import BoardMatch from './screens/BoardMatch'
import You from './screens/You'
import EmptyState from './components/EmptyState'
import ErrorState from './components/ErrorState'
import TabBar from './components/TabBar'
import { OverviewSkeleton } from './components/Skeleton'
import { PlayerDataProvider, usePlayerData } from './lib/PlayerData'
import { matchPath, navigate, restoreScroll, useRoute } from './lib/router'
import { clearSession, getStoredPlayer, verifySession } from './lib/api'
import { SetupCard, SetupPrompt } from './components/SetupSignIn'
import { applyTheme, getThemeChoice, watchSystemTheme } from './lib/theme'
import { canReturnUnaided } from './lib/account'
import LinkCode from './screens/LinkCode'
import { useState } from 'react'
import './App.css'

const TITLES = {
  '/': 'PaddlePad',
  '/matches': 'Matches · PaddlePad',
  '/people': 'People · PaddlePad',
  '/you': 'You · PaddlePad',
}

/**
 * The signed-in app: route table, tab bar, and the states that wrap
 * every screen.
 *
 * Loading and error live here rather than in each screen so there is one
 * definition of what "not ready" looks like. A skeleton on one tab and a
 * sentence on another is exactly the inconsistency that reads as
 * unfinished.
 */
function SignedIn({ player, onSignOut, onSignedOut, onPlayerChange }) {
  const path = useRoute()
  const { summary, loading, error, refresh, matches } = usePlayerData()

  useEffect(() => {
    document.title = TITLES[path] ?? 'PaddlePad'
  }, [path])

  // Browsers restore scroll for real navigations but not for pushState,
  // so returning from a match to a long list would otherwise land at the
  // top every time.
  useEffect(() => {
    restoreScroll()
  }, [path])

  if (loading && !summary) {
    return (
      <div className="app-body">
        <OverviewSkeleton />
      </div>
    )
  }

  if (error && matches.length === 0) {
    return (
      <div className="app-body">
        <ErrorState message={error} onRetry={refresh} />
      </div>
    )
  }

  // A player with no finished matches has nothing to navigate between,
  // so they get the one honest screen rather than four empty tabs.
  //
  // `/you` is exempt, and that exemption is load-bearing. Without it
  // this branch swallows the tab bar too, so the profile -- and with it
  // setting up sign-in and linking a code -- was unreachable for
  // precisely the person who had just arrived with a code and nothing
  // else. Matches and People stay collapsed; there is genuinely nothing
  // on them.
  if (summary && summary.matches === 0 && path !== '/you') {
    return (
      <div className="app-body">
        <EmptyStateScreen
          player={player}
          onSignOut={onSignOut}
          onPlayerChange={onPlayerChange}
        />
      </div>
    )
  }

  const matchRoute = matchPath('/matches/:id', path)
  const personRoute = matchPath('/people/:name', path)
  const boardMatchRoute = matchPath('/board/match/:id', path)

  let screen
  if (path === '/')
    screen = <Overview player={player} onPlayerChange={onPlayerChange} />
  else if (path === '/rating') screen = <Rating />
  else if (path === '/matches') screen = <Matches />
  else if (matchRoute) screen = <MatchDetail id={matchRoute.id} />
  else if (path === '/people') screen = <People />
  else if (personRoute) screen = <PersonDetail name={personRoute.name} />
  else if (boardMatchRoute) screen = <BoardMatch id={boardMatchRoute.id} />
  else if (path === '/you')
    screen = (
      <You
        player={player}
        onSignOut={onSignOut}
        onSignedOut={onSignedOut}
        onPlayerChange={onPlayerChange}
      />
    )
  else screen = <NotFound />

  return (
    <>
      <div className="app-body">
        {/* A refresh that failed while data is already on screen is a
            note, not a takeover -- the numbers shown are still real,
            just slightly old. */}
        {error && <p className="stale-note">Couldn&rsquo;t refresh just now.</p>}
        {screen}
      </div>
      <TabBar path={path} />
    </>
  )
}

function EmptyStateScreen({ player, onSignOut, onPlayerChange }) {
  const { inProgress } = usePlayerData()
  return (
    <>
      <div className="profile-top">
        <button className="link" onClick={() => navigate('/you')}>
          Your profile
        </button>
        <button className="link" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <EmptyState name={player.name} inProgress={inProgress} />
      {/* One card, whichever this person actually needs. Someone who
          came in by code already has their umpire's record, so linking
          is meaningless to them -- what they lack is a way back in.
          Someone with an account and an empty page is being told why it
          is empty. */}
      {canReturnUnaided(player) ? (
        <LinkCode onPlayerChange={onPlayerChange} />
      ) : (
        <SetupCard player={player} onPlayerChange={onPlayerChange} />
      )}
    </>
  )
}

function NotFound() {
  return (
    <div className="not-found">
      <h1>Not here</h1>
      <p className="muted">That page doesn&rsquo;t exist.</p>
      <button type="button" className="retry" onClick={() => navigate('/')}>
        Go to your overview
      </button>
    </div>
  )
}

function App() {
  // Seeded from storage so a returning player isn't flashed the claim
  // screen while their token is being re-checked.
  const [player, setPlayer] = useState(getStoredPlayer)
  const [checked, setChecked] = useState(false)

  // The inline script in index.html has already painted the right
  // colour; this only keeps it right afterwards. Picking "System" and
  // then switching the phone to dark has to change the app there and
  // then, or the setting reads as broken.
  useEffect(() => watchSystemTheme(() => applyTheme(getThemeChoice())), [])

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

  // The state reset on its own, with nothing to confirm. Deleting a
  // profile ends here too: that flow has already asked for a password
  // and said what it would destroy, and following it with "are you
  // sure you want to sign out?" would be absurd.
  function handleSignedOut() {
    clearSession()
    setPlayer(null)
    navigate('/', { replace: true })
  }

  function handleSignOut() {
    // Only worth asking about when getting back in is genuinely hard.
    // Someone with a password, or with Google connected, can sign in
    // again themselves; someone who came in by code has to find an
    // umpire, so they get warned first.
    const warning = canReturnUnaided(player)
      ? null
      : 'Sign out? You’ll need your code again to get back in.'
    if (warning && !confirm(warning)) return
    handleSignedOut()
  }

  if (!player && !checked) {
    return (
      <main className="app">
        <OverviewSkeleton />
      </main>
    )
  }

  if (!player) {
    return (
      <main className="app">
        <SignIn onSignedIn={setPlayer} />
      </main>
    )
  }

  return (
    <main className="app app-tabbed">
      {/* Mounted here rather than inside SignedIn on purpose: SignedIn
          returns early three times before its main render, and a prompt
          that only appears on some of those branches is the bug this is
          meant to fix. */}
      <SetupPrompt player={player} onPlayerChange={setPlayer} />
      <PlayerDataProvider>
        <SignedIn
          player={player}
          onSignOut={handleSignOut}
          onSignedOut={handleSignedOut}
          onPlayerChange={setPlayer}
        />
      </PlayerDataProvider>
    </main>
  )
}

export default App
