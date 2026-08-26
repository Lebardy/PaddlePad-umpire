// ============================================================
// The account screen.
//
// Small on purpose. A player does not administer anything here -- the
// umpire owns the roster, so there is no name to edit and no settings to
// set. What it does is answer "is this mine, and how do I get out": the
// name, when they joined, their record, and a sign-out that warns first.
//
// Name editing is deliberately absent. Two places to change a name means
// two versions of who someone is, and one shared player identity is the
// thing the whole database is built around -- it is why players live in
// one table with a case-insensitive unique name.
// ============================================================

import { usePlayerData } from '../lib/PlayerData'
import { currentStreak, longestWinStreak } from '../lib/derive'
import Avatar from '../components/Avatar'

const VERSION = __APP_VERSION__

function joinedLabel(claimedAt) {
  if (!claimedAt) return null
  return new Date(claimedAt).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function You({ player, onSignOut }) {
  const { summary, matches } = usePlayerData()
  const joined = joinedLabel(player.claimedAt)
  const streak = currentStreak(matches)
  const best = longestWinStreak(matches)

  return (
    <div className="you-screen">
      <header className="you-head">
        <Avatar name={player.name} size="lg" />
        <h1>{player.name}</h1>
        {joined && <p className="muted-inline">Playing since {joined}</p>}
      </header>

      {summary && summary.matches > 0 && (
        <section className="you-record" aria-label="Your record">
          <ul>
            <li>
              <span className="yr-value">
                {summary.wins}&ndash;{summary.losses}
              </span>
              <span className="yr-label">Record</span>
            </li>
            <li>
              <span className="yr-value">{summary.matches}</span>
              <span className="yr-label">Matches</span>
            </li>
            <li>
              <span className="yr-value">
                {streak ? `${streak.length}${streak.won ? 'W' : 'L'}` : '—'}
              </span>
              <span className="yr-label">Current streak</span>
            </li>
            <li>
              <span className="yr-value">{best || '—'}</span>
              <span className="yr-label">Best win streak</span>
            </li>
          </ul>
        </section>
      )}

      <section className="you-about" aria-label="About">
        <h2>About</h2>
        <p>
          PaddlePad shows the matches an umpire recorded for you. Every number
          here is a plain count of what was tapped courtside — nothing is
          estimated, and nothing is compared against anyone else.
        </p>
        <p className="muted-inline">Version {VERSION}</p>
      </section>

      <section className="you-install" aria-label="Install">
        <h2>Keep it handy</h2>
        {/* Written out rather than a custom install button: the browser
            prompt never fires on iOS and only fires on Android under
            heuristics nobody controls, so a button that may never appear
            is worse than an instruction that always does. */}
        <p>
          Add PaddlePad to your home screen from your browser&rsquo;s share menu
          and it opens like any other app.
        </p>
      </section>

      <button type="button" className="sign-out" onClick={onSignOut}>
        Sign out
      </button>
      <p className="sign-out-note">
        You&rsquo;ll need your code again to sign back in — ask whoever scores
        your matches if you don&rsquo;t have it.
      </p>
    </div>
  )
}

export default You
