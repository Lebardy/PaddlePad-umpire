import { useState } from 'react'
import { login, linkGoogleAccount, loginWithGoogle, register } from '../lib/api'
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
  const [googleToken, setGoogleToken] = useState(null)

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
  async function handleGoogle(accessToken) {
    setError(null)
    setBusy(true)
    setGoogleToken(accessToken)
    try {
      onSignedIn(await loginWithGoogle({ accessToken, invite }))
    } catch (err) {
      setError(err.message)
      if (err.details?.needsInvite) setNeedsInvite(true)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Attaches this Google account to an account they already have,
   * proved with its password. For the umpire whose Google address is
   * not the one they signed up with -- matching addresses are linked
   * automatically and never reach this screen.
   */
  async function submitGoogleLink(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onSignedIn(
        await linkGoogleAccount({ accessToken: googleToken, email, password }),
      )
    } catch (err) {
      setError(err.message)
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
      onSignedIn(await loginWithGoogle({ accessToken: googleToken, invite }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /** Backs out of a half-finished Google sign-up. */
  function cancelGoogle() {
    setNeedsInvite(false)
    setGoogleToken(null)
    setInvite('')
    setError(null)
  }

  function switchMode() {
    setMode(isRegister ? 'login' : 'register')
    setError(null)
  }

  return (
    <div className="login">
      <h2>{isRegister ? 'Create umpire account' : 'Umpire sign in'}</h2>

      {/* Mid-Google-signup this takes over the screen. Leaving the
          email form below it would offer a second, unrelated way in at
          the exact moment someone is halfway through the first. */}
      {needsInvite ? (
        <>
          <p className="login-note">
            We don&rsquo;t recognise that Google account yet. Signing in with
            Google proves who you are, not that you belong to this club.
          </p>

          {/* Two genuinely different people arrive here. Someone new,
              who needs an invite, and an existing umpire whose Google
              address simply is not the one they signed up with --
              matching addresses are linked automatically and never
              reach this screen. Offering only the invite would send the
              second person looking for a code they do not need. */}
          <section className="google-choice">
            <h3>I have an invite code</h3>
            <form className="google-invite" onSubmit={submitGoogleInvite}>
              <label>
                Invite code
                <input
                  type="text"
                  placeholder="PAD-7K3M-9QXR"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="submit"
                className="start-match"
                disabled={busy || !invite.trim()}
              >
                {busy ? 'Checking…' : 'Create my account'}
              </button>
            </form>
          </section>

          <div className="or-divider">
            <span>or</span>
          </div>

          <section className="google-choice">
            <h3>I&rsquo;m already an umpire here</h3>
            <p className="field-hint">
              Sign in once with your existing details and this Google account
              will be attached to them.
            </p>
            <form className="google-invite" onSubmit={submitGoogleLink}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="start-match"
                disabled={busy || !email.trim() || !password}
              >
                {busy ? 'Linking…' : 'Link my account'}
              </button>
            </form>
          </section>

          {error && <p className="form-error">{error}</p>}
          <button type="button" className="link-btn" onClick={cancelGoogle}>
            Start over
          </button>
        </>
      ) : (
        <>
          <p className="login-note">
            Matches are recorded against your account, so scores can be traced
            back to whoever logged them.
          </p>

          {/* Above BOTH ways of creating an account, because it feeds
              both. It used to sit inside the email form below, so
              someone holding a code pasted it there and then reached
              for the Google button -- which worked, since the two read
              the same state, but nothing said so. */}
          {isRegister && (
            <div className="invite-block">
              <label>
                Invite code
                <input
                  type="text"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="PAD-7K3M-9QXR"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <p className="field-hint">
                From whoever runs this club. Needed either way.
              </p>
            </div>
          )}

          {/* Deliberately NOT disabled on an empty invite. An umpire who
              already exists is recognised by Google alone and signed
              straight in; the code is only consulted when Google
              presents an account nobody here knows. */}
          <GoogleButton
            onCredential={handleGoogle}
            disabled={busy}
            caption={isRegister ? 'Uses the invite code above' : null}
          />
        </>
      )}

      {!needsInvite && (
      <form onSubmit={handleSubmit}>
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

        {/* The invite input moved above the Google button, which took
            it out of this form's native validation -- so the check has
            to be here rather than on the field. */}
        <button
          type="submit"
          className="start-match"
          disabled={busy || (isRegister && !invite.trim())}
        >
          {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>
      )}

      {!needsInvite && (
        <button className="link-button" onClick={switchMode}>
          {isRegister
            ? 'Already have an account? Sign in'
            : 'Have an invite code? Create an account'}
        </button>
      )}
    </div>
  )
}

export default Login
