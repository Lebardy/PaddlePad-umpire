import { useState } from 'react'
import { login, loginWithGoogle, register } from '../lib/api'
import GoogleButton from '../components/GoogleButton'

// Sign-in / sign-up gate shown when no umpire is authenticated.
//
// Registration requires an invite code from an existing umpire. The
// API is reachable from the public internet, so an open form would let
// anyone create an account and write into the match data.
function Login({ onSignedIn }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Set when the server refuses a new Google account for want of an
  // invite. The credential is kept so supplying one does not mean
  // signing in with Google a second time.
  const [needsInvite, setNeedsInvite] = useState(false)
  const [googleCredential, setGoogleCredential] = useState(null)

  const isRegister = mode === 'register'

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const umpire = isRegister
        ? await register({ email, name, password, invite })
        : await login({ email, password })
      onSignedIn(umpire)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Google has proved who they are; the server decides whether they may
   * have an account. A brand-new Google account still needs an invite,
   * and the server says so with `needsInvite` -- which reveals the
   * field and keeps the credential so the second attempt does not make
   * them sign in with Google all over again.
   */
  async function handleGoogle(credential) {
    setError(null)
    setBusy(true)
    setGoogleCredential(credential)
    try {
      onSignedIn(await loginWithGoogle({ credential, invite }))
    } catch (err) {
      setError(err.message)
      if (err.details?.needsInvite) setNeedsInvite(true)
    } finally {
      setBusy(false)
    }
  }

  /** Retries the Google sign-in now that an invite has been typed. */
  async function submitGoogleInvite(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onSignedIn(await loginWithGoogle({ credential: googleCredential, invite }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(isRegister ? 'login' : 'register')
    setError(null)
  }

  return (
    <div className="login">
      <h2>{isRegister ? 'Create umpire account' : 'Umpire sign in'}</h2>

      {needsInvite ? (
        <form className="google-invite" onSubmit={submitGoogleInvite}>
          <p className="login-note">
            Almost there. New accounts need an invite code from whoever runs
            this club — signing in with Google proves who you are, not that
            you belong here.
          </p>
          <input
            type="text"
            placeholder="Invite code"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={busy || !invite.trim()}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      ) : (
        <GoogleButton onCredential={handleGoogle} disabled={busy} />
      )}
      <p className="login-note">
        Matches are recorded against your account, so scores can be traced
        back to whoever logged them.
      </p>

      <form onSubmit={handleSubmit}>
        {isRegister && (
          <label>
            Invite code
            <input
              type="text"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="PAD-7K3M-9QXR"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        {isRegister && (
          <label>
            Name
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        )}

        <label>
          Password
          <input
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={isRegister ? 8 : undefined}
            required
          />
        </label>

        {isRegister && (
          <p className="field-hint">At least 8 characters.</p>
        )}

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="start-match" disabled={busy}>
          {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button className="link-button" onClick={switchMode}>
        {isRegister
          ? 'Already have an account? Sign in'
          : 'Have an invite code? Create an account'}
      </button>
    </div>
  )
}

export default Login
