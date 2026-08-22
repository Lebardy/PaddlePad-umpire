import { useState } from 'react'
import { login, register } from '../lib/api'

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

  function switchMode() {
    setMode(isRegister ? 'login' : 'register')
    setError(null)
  }

  return (
    <div className="login">
      <h2>{isRegister ? 'Create umpire account' : 'Umpire sign in'}</h2>
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
