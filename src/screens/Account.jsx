import { useState } from 'react'
import {
  changeUmpirePassword,
  connectGoogle,
  disconnectGoogle,
  updateUmpire,
} from '../lib/api'
import GoogleButton from '../components/GoogleButton'
import { THEMES, getThemeChoice, setThemeChoice } from '../lib/theme'

// ============================================================
// The umpire's own account.
//
// Until this screen existed a signed-in umpire could change nothing.
// Connecting Google meant signing OUT, tapping Continue with Google,
// being refused, and taking the "I'm already an umpire here" branch on
// the gate -- and signing out is the one thing an umpire holding
// unsynced matches must not do. Everything here is reachable mid-night
// without touching the sign-in screen.
//
// Laid out the same way as the player app's settings: one row per
// thing, only one open at a time. Editing one thing at a time is the
// difference between a profile screen and a form nobody finishes.
//
// What is deliberately NOT here: deleting the account, because sessions
// and matches carry created_by and there is no deactivation path for an
// umpire the way there is for a player; and promoting anyone to admin,
// which schema.sql leaves as a manual UPDATE so control over who can
// issue invites stays with whoever runs the club.
// ============================================================

const VERSION = __APP_VERSION__

/** One editable thing: its current value, a button, and the form. */
function DetailRow({ label, value, action, isOpen, onToggle, saved, children }) {
  return (
    <div className={`detail-row${isOpen ? ' is-open' : ''}`}>
      <div className="detail-head">
        <div className="detail-text">
          <span className="detail-label">{label}</span>
          <span className="detail-value">{value}</span>
        </div>
        <button type="button" className="link-btn" onClick={onToggle}>
          {isOpen ? 'Cancel' : action}
        </button>
      </div>
      {!isOpen && saved && <p className="detail-saved">Saved.</p>}
      {isOpen && children}
    </div>
  )
}

/** The submit/busy/error handling every one of these little forms needs. */
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
    <form className="account-form" onSubmit={handleSubmit}>
      {children}
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={busy || !canSubmit}>
        {busy ? 'Saving…' : label}
      </button>
    </form>
  )
}

/**
 * Connecting Google, and disconnecting it again.
 *
 * Not an EditForm like its neighbours, because there is nothing to
 * submit: Google's popup is the submit, and the password beside it is a
 * condition of it rather than the thing being saved.
 *
 * The password is asked for whenever the account has one. Google proves
 * someone owns a Google account; only the password proves they own this
 * one. Without it a phone left unlocked on this screen is an account
 * takeover, and a silent one -- attaching a stranger's Google account
 * hands them permanent one-tap access without locking the owner out to
 * notice.
 */
function GoogleRow({ umpire, onUmpireChange, isOpen, onToggle, saved, onSaved }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const connected = Boolean(umpire.googleEmail)
  // Undefined on an umpire stored by an older build, before the server
  // returned this. Assuming they have one is the safe way to be wrong:
  // the field is shown, and the server decides.
  const hasPassword = umpire.hasPassword !== false

  function finish(next) {
    onUmpireChange(next)
    setCurrentPassword('')
    onSaved()
  }

  async function connect(accessToken) {
    setBusy(true)
    setError(null)
    try {
      finish(await connectGoogle({ accessToken, currentPassword }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      finish(await disconnectGoogle({ currentPassword }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const passwordField = hasPassword && (
    <label>
      Your password
      <input
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
      />
    </label>
  )

  return (
    <DetailRow
      label="Google"
      value={connected ? umpire.googleEmail : 'Not connected'}
      action={connected ? 'Disconnect' : 'Connect'}
      isOpen={isOpen}
      saved={saved}
      onToggle={onToggle}
    >
      {connected ? (
        <form className="account-form" onSubmit={disconnect}>
          <p className="field-hint">
            {hasPassword
              ? 'You will sign in with your email and password after this.'
              : 'Google is the only way into this account. Set a password first — there are no reset emails here.'}
          </p>
          {passwordField}
          {error && <p className="form-error">{error}</p>}
          <button
            type="submit"
            className="danger-btn"
            disabled={busy || !hasPassword || !currentPassword}
          >
            {busy ? 'Disconnecting…' : 'Disconnect Google'}
          </button>
        </form>
      ) : (
        <div className="account-form">
          {passwordField}
          {passwordField && (
            <p className="field-hint">
              Asked for because this changes how you sign in.
            </p>
          )}
          <GoogleButton
            onCredential={connect}
            disabled={busy || (hasPassword && !currentPassword)}
            caption="One tap to get back in, on any phone, with nothing to remember."
          />
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
    </DetailRow>
  )
}

function Account({ umpire, onUmpireChange, onBack, onSignOut }) {
  const [open, setOpen] = useState(null)
  const [saved, setSaved] = useState(null)

  const [name, setName] = useState(umpire.name)
  const [email, setEmail] = useState(umpire.email)
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [theme, setTheme] = useState(getThemeChoice)

  const hasPassword = umpire.hasPassword !== false

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
    onUmpireChange(await updateUmpire({ name }))
    done('name')
  }

  async function saveEmail() {
    onUmpireChange(await updateUmpire({ email, currentPassword }))
    done('email')
  }

  async function savePassword() {
    onUmpireChange(await changeUmpirePassword({ currentPassword, password }))
    done('password')
  }

  function chooseTheme(choice) {
    setThemeChoice(choice)
    setTheme(choice)
  }

  return (
    <div className="account">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>

      <h2>Your account</h2>
      <p className="login-note">
        How you sign in, and how the app looks. Your name is what other
        umpires see against the sessions you score.
      </p>

      <DetailRow
        label="Name"
        value={umpire.name}
        action="Change"
        isOpen={open === 'name'}
        saved={saved === 'name'}
        onToggle={() => toggle('name', () => setName(umpire.name))}
      >
        <EditForm onSubmit={saveName} canSubmit={Boolean(name.trim())} label="Save name">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </EditForm>
      </DetailRow>

      <DetailRow
        label="Email"
        value={umpire.email}
        action="Change"
        isOpen={open === 'email'}
        saved={saved === 'email'}
        onToggle={() => toggle('email', () => setEmail(umpire.email))}
      >
        <EditForm
          onSubmit={saveEmail}
          canSubmit={email.includes('@') && (!hasPassword || Boolean(currentPassword))}
          label="Save email"
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {hasPassword && (
            <>
              <label>
                Your password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              {/* Not caution for its own sake. Signing in with Google
                  attaches to an umpire whose email matches, so an
                  address quietly changed to someone else's is a way in
                  that never needed the password. */}
              <p className="field-hint">
                Asked for because your email is how you sign in.
              </p>
            </>
          )}
        </EditForm>
      </DetailRow>

      <DetailRow
        label="Password"
        value={hasPassword ? '••••••••' : 'Not set — Google only'}
        action={hasPassword ? 'Change' : 'Set one'}
        isOpen={open === 'password'}
        saved={saved === 'password'}
        onToggle={() => toggle('password')}
      >
        <EditForm
          onSubmit={savePassword}
          canSubmit={password.length >= 8 && (!hasPassword || Boolean(currentPassword))}
          label={hasPassword ? 'Change password' : 'Set password'}
        >
          {hasPassword && (
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
          )}
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p className="field-hint">At least 8 characters.</p>
        </EditForm>
      </DetailRow>

      <GoogleRow
        umpire={umpire}
        onUmpireChange={onUmpireChange}
        isOpen={open === 'google'}
        saved={saved === 'google'}
        onToggle={() => toggle('google')}
        onSaved={() => done('google')}
      />

      <div className="detail-row">
        <div className="detail-head">
          <div className="detail-text">
            <span className="detail-label">Appearance</span>
            <span className="detail-value">
              {THEMES.find((t) => t.key === theme)?.label}
            </span>
          </div>
        </div>
        <div className="theme-choices">
          {THEMES.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`theme-choice${theme === option.key ? ' is-on' : ''}`}
              onClick={() => chooseTheme(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {onSignOut && (
        <button type="button" className="sign-out" onClick={onSignOut}>
          Sign out
        </button>
      )}

      <p className="account-footer">
        Version {VERSION}
      </p>
    </div>
  )
}

export default Account
