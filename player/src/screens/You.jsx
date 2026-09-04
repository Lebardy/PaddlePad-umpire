// ============================================================
// The settings screen.
//
// This used to say a player administers nothing here, because for a
// long time that was true: an umpire created the person, handed over a
// claim code, and typing that code WAS the login. There was no account
// to edit and no way to leave.
//
// There is now, and this is where all of it lives: how the app looks,
// who you are, how you sign in, and how you leave. What stays true is
// that the match record is not solely theirs -- see DeleteProfile for
// what that costs and why it is the honest answer.
//
// The record tiles that used to open this screen have gone. Every one
// of them -- record, matches, current streak, best win streak -- is on
// the overview already, in the hero and the stat grid, and a settings
// page is not where anyone looks for their form.
// ============================================================

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import { setCredentials, updateProfile } from '../lib/api'
import { THEMES, getThemeChoice, setThemeChoice } from '../lib/theme'
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

/**
 * Light, dark, or follow the phone.
 *
 * The same segmented control the Matches filters use, rather than a
 * switch: a two-state toggle cannot express "follow the system", which
 * is the right default and the one most people should stay on.
 */
function ThemeChoice() {
  const [choice, setChoice] = useState(getThemeChoice)

  function pick(next) {
    setChoice(next)
    setThemeChoice(next)
  }

  return (
    <section className="you-section" aria-label="Appearance">
      <h2>Appearance</h2>
      <div className="filter-row" role="group" aria-label="Theme">
        {THEMES.map((theme) => (
          <button
            key={theme.key}
            type="button"
            className={`filter ${choice === theme.key ? 'filter-active' : ''}`}
            aria-pressed={choice === theme.key}
            onClick={() => pick(theme.key)}
          >
            {theme.label}
          </button>
        ))}
      </div>
      {choice === 'system' && (
        <p className="detail-note">
          Following your phone&rsquo;s setting. It changes when your phone does.
        </p>
      )}
    </section>
  )
}

function You({ player, onSignOut, onSignedOut, onPlayerChange }) {
  const joined = joinedLabel(player.claimedAt)

  return (
    <div className="you-screen">
      <header className="you-head">
        <Avatar name={player.name} size="lg" />
        <h1>{player.name}</h1>
        {joined && <p className="muted-inline">Playing since {joined}</p>}
      </header>

      <ThemeChoice />

      <Details player={player} onPlayerChange={onPlayerChange} />

      <LinkCode onPlayerChange={onPlayerChange} />

      <section className="you-section" aria-label="This app">
        <h2>This app</h2>
        <p>
          PaddlePad shows the matches an umpire recorded for you. Every number
          here is a plain count of what was tapped courtside — nothing is
          estimated, and nothing is compared against anyone else.
        </p>
        {/* Written out rather than a custom install button: the browser
            prompt never fires on iOS and only fires on Android under
            heuristics nobody controls, so a button that may never appear
            is worse than an instruction that always does. */}
        <p>
          Add PaddlePad to your home screen from your browser&rsquo;s share menu
          and it opens like any other app.
        </p>
        <p className="muted-inline">Version {VERSION}</p>
      </section>

      <section className="you-section" aria-label="Account">
        <h2>Account</h2>
        <button type="button" className="sign-out" onClick={onSignOut}>
          Sign out
        </button>
        {/* Only a warning while it is actually true. Someone with a
            password can let themselves back in. */}
        {!player.username && (
          <p className="sign-out-note">
            You&rsquo;ll need your code again to sign back in — ask whoever
            scores your matches if you don&rsquo;t have it.
          </p>
        )}

        <DeleteProfile player={player} onDeleted={onSignedOut} />
      </section>
    </div>
  )
}

export default You
