import { useState } from 'react'
import Gate from '../components/Gate'
import GoogleButton from '../components/GoogleButton'
import { signIn, signInWithBackupCode, signInWithGoogle } from '../lib/api'
import { navigate } from '../lib/navigation'

export default function SignIn({ onSignedIn }) {
  const [usingBackupCode, setUsingBackupCode] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(action) {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await action())
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // A backup code is an emergency way in, so it lands straight on
  // Account rather than the ordinary home page, where the used-backup-
  // code notice is waiting.
  async function runBackupCode() {
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await signInWithBackupCode({ email, code }))
      navigate('/account', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  function swap(next) {
    setUsingBackupCode(next)
    setError(null)
  }

  if (usingBackupCode) {
    return (
      <Gate>
        <form className="gate-form" onSubmit={(e) => { e.preventDefault(); runBackupCode() }}>
          <h1>Sign in</h1>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Backup code</span>
            <input value={code} placeholder="XXXXX-XXXXX" onChange={(e) => setCode(e.target.value)} required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="gate-link" onClick={() => swap(false)}>Use your password instead</button>
        </form>
      </Gate>
    )
  }

  return (
    <Gate>
      <form className="gate-form" onSubmit={(e) => { e.preventDefault(); run(() => signIn({ email, password })) }}>
        <h1>Sign in</h1>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <GoogleButton withDivider disabled={busy} label="Sign in with Google" onToken={(token) => run(() => signInWithGoogle(token))} />
        <button type="button" className="gate-link" onClick={() => swap(true)}>Use a backup code</button>
        <p className="gate-note">Admin accounts are added by the owner. There is no sign-up here.</p>
      </form>
    </Gate>
  )
}
