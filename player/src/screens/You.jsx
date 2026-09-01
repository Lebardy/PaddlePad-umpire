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

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import { setCredentials } from '../lib/api'
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

/**
 * Turning a code-only session into a real account, or changing the
 * password on one that already exists.
 *
 * This is the half of the design that actually retires "you'll need your
 * code again to get back in". Someone handed a QR courtside gets in
 * without filling anything in, and can come back here later, unhurried,
 * to make that permanent -- which is a far better order than demanding a
 * password from someone who just wanted to see their match.
 */
function SigningIn({ player, onPlayerChange }) {
  const existing = player.username
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState(existing ?? '')
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onPlayerChange(await setCredentials({ username, password, currentPassword }))
      setPassword('')
      setCurrentPassword('')
      setOpen(false)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="you-signin" aria-label="Signing in">
      <h2>Signing in</h2>

      {existing ? (
        <p>
          You sign in as <strong>{existing}</strong>. Your code still works too,
          which is how you get back in if you forget your password.
        </p>
      ) : (
        <p>
          You got in with a code, so you need it again every time. Pick a
          username and password and you won&rsquo;t.
        </p>
      )}

      {done && !open && (
        <p className="signin-done">Saved. You can sign in with that now.</p>
      )}

      {open ? (
        <form className="signin-form" onSubmit={handleSubmit}>
          <label htmlFor="you-username">Username</label>
          <input
            id="you-username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <p className="hint">Letters, numbers and underscores.</p>

          {existing && (
            <>
              <label htmlFor="you-current">Current password</label>
              <input
                id="you-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </>
          )}

          <label htmlFor="you-password">
            {existing ? 'New password' : 'Password'}
          </label>
          <input
            id="you-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p className="hint">At least 8 characters.</p>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? 'Saving…' : existing ? 'Change password' : 'Set up sign-in'}
          </button>
          <button type="button" className="link" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="signin-start" onClick={() => setOpen(true)}>
          {existing ? 'Change password' : 'Set up a username and password'}
        </button>
      )}
    </section>
  )
}

function You({ player, onSignOut, onPlayerChange }) {
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

      <SigningIn player={player} onPlayerChange={onPlayerChange} />

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
      {/* Only a warning while it is actually true. Someone with a
          password can let themselves back in. */}
      {!player.username && (
        <p className="sign-out-note">
          You&rsquo;ll need your code again to sign back in — ask whoever scores
          your matches if you don&rsquo;t have it.
        </p>
      )}
    </div>
  )
}

export default You
