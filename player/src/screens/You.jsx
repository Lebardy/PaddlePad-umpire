// ============================================================
// The profile screen.
//
// This used to say a player administers nothing here, because for a
// long time that was true: an umpire created the person, handed over a
// claim code, and typing that code WAS the login. There was no account
// to edit and no way to leave.
//
// There is now. A player has a name they can correct, a username and
// password they can change, and a way to delete the whole thing. What
// stays true is that the match record is not solely theirs -- see
// DeleteProfile for what that costs and why it is the honest answer.
// ============================================================

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import { setCredentials, updateProfile } from '../lib/api'
import { currentStreak, longestWinStreak } from '../lib/derive'
import Avatar from '../components/Avatar'
import DeleteProfile from './DeleteProfile'
import LinkCode from './LinkCode'

const VERSION = __APP_VERSION__

function joinedLabel(claimedAt) {
  if (!claimedAt) return null
  return new Date(claimedAt).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

/**
 * One editable field: the current value, a button to change it, and the
 * form it opens.
 *
 * `open` is held by the parent rather than per row, so opening one
 * closes the rest. Editing one thing at a time is the difference
 * between a profile screen and a settings form nobody finishes.
 */
function DetailRow({ label, value, action, isOpen, onToggle, saved, children }) {
  return (
    <div className={`detail-row${isOpen ? ' is-open' : ''}`}>
      <div className="detail-head">
        <div>
          <span className="detail-label">{label}</span>
          <span className="detail-value">{value}</span>
        </div>
        <button type="button" className="link" onClick={onToggle}>
          {isOpen ? 'Cancel' : action}
        </button>
      </div>
      {!isOpen && saved && <p className="signin-done">Saved.</p>}
      {isOpen && children}
    </div>
  )
}

/**
 * Wraps the submit/busy/error handling every one of these little forms
 * needs, so each form below is just its fields.
 */
function EditForm({ onSubmit, canSubmit, label, children }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="signin-form" onSubmit={handleSubmit}>
      {children}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || !canSubmit}>
        {busy ? 'Saving…' : label}
      </button>
    </form>
  )
}

function Details({ player, onPlayerChange }) {
  const { refresh } = usePlayerData()
  const [open, setOpen] = useState(null)
  const [saved, setSaved] = useState(null)

  const [name, setName] = useState(player.name)
  const [username, setUsername] = useState(player.username ?? '')
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')

  function toggle(field, reset) {
    setSaved(null)
    setOpen((current) => {
      if (current === field) return null
      reset?.()
      return field
    })
  }

  function done(field) {
    setOpen(null)
    setSaved(field)
    setPassword('')
    setCurrentPassword('')
  }

  async function saveName() {
    onPlayerChange(await updateProfile({ name }))
    // The header above reads from `player`, which onPlayerChange just
    // updated; this is for everything derived from the history.
    refresh()
    done('name')
  }

  async function saveUsername() {
    onPlayerChange(await setCredentials({ username, currentPassword }))
    done('username')
  }

  async function savePassword() {
    await setCredentials({ password, currentPassword })
    done('password')
  }

  async function saveSetup() {
    onPlayerChange(await setCredentials({ username, password }))
    done('username')
  }

  return (
    <section className="you-details" aria-label="Your details">
      <h2>Your details</h2>

      <DetailRow
        label="Name"
        value={player.name}
        action="Edit"
        isOpen={open === 'name'}
        saved={saved === 'name'}
        onToggle={() => toggle('name', () => setName(player.name))}
      >
        <EditForm onSubmit={saveName} canSubmit={name.trim().length > 0} label="Save name">
          <label htmlFor="you-name">Your name</label>
          <input
            id="you-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          {/* The warning the whole rename decision rests on. Renaming
              is safe for the data -- matches point at an id, not a name
              -- but the umpire's roster changes under them, and they
              are the person who has to find you at the net. */}
          <p className="hint">
            This is the name whoever scores your matches looks for on the
            roster. Changing it changes what they see.
          </p>
        </EditForm>
      </DetailRow>

      {player.username ? (
        <>
          <DetailRow
            label="Username"
            value={player.username}
            action="Edit"
            isOpen={open === 'username'}
            saved={saved === 'username'}
            onToggle={() => toggle('username', () => setUsername(player.username))}
          >
            <EditForm
              onSubmit={saveUsername}
              canSubmit={username.trim().length > 0 && currentPassword.length > 0}
              label="Save username"
            >
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

              <label htmlFor="you-current-u">Your password</label>
              <input
                id="you-current-u"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
              {/* Not bureaucracy: changing the username someone signs in
                  with locks them out exactly as well as changing the
                  password does. */}
              <p className="hint">
                Asked for because changing this changes how you sign in.
              </p>
            </EditForm>
          </DetailRow>

          <DetailRow
            label="Password"
            value="••••••••"
            action="Change"
            isOpen={open === 'password'}
            saved={saved === 'password'}
            onToggle={() => toggle('password')}
          >
            <EditForm
              onSubmit={savePassword}
              canSubmit={currentPassword.length > 0 && password.length > 0}
              label="Change password"
            >
              <label htmlFor="you-current-p">Current password</label>
              <input
                id="you-current-p"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />

              <label htmlFor="you-password">New password</label>
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
            </EditForm>
          </DetailRow>

          <p className="detail-note">
            Your code still works too, which is how you get back in if you
            forget your password.
          </p>
        </>
      ) : (
        // A player who came in by code has no username to edit yet, so
        // the two rows collapse into the one prompt. That flow already
        // works and must not gain a step.
        <DetailRow
          label="Signing in"
          value="Code only"
          action="Set up"
          isOpen={open === 'signin'}
          saved={saved === 'username'}
          onToggle={() => toggle('signin')}
        >
          <EditForm
            onSubmit={saveSetup}
            canSubmit={username.trim().length > 0 && password.length > 0}
            label="Set up sign-in"
          >
            <label htmlFor="you-new-username">Username</label>
            <input
              id="you-new-username"
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

            <label htmlFor="you-new-password">Password</label>
            <input
              id="you-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <p className="hint">At least 8 characters.</p>
          </EditForm>
        </DetailRow>
      )}

      {!player.username && open !== 'signin' && (
        <p className="detail-note">
          You got in with a code, so you need it again every time. Pick a
          username and password and you won&rsquo;t.
        </p>
      )}
    </section>
  )
}

function You({ player, onSignOut, onSignedOut, onPlayerChange }) {
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

      <Details player={player} onPlayerChange={onPlayerChange} />

      <LinkCode onPlayerChange={onPlayerChange} />

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
      {/* Only a warning while it is actually true. Someone with a
          password can let themselves back in. */}
      {!player.username && (
        <p className="sign-out-note">
          You&rsquo;ll need your code again to sign back in — ask whoever scores
          your matches if you don&rsquo;t have it.
        </p>
      )}

      <DeleteProfile player={player} onDeleted={onSignedOut} />
    </div>
  )
}

export default You
