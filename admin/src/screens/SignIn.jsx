import { useState } from 'react'
import GoogleButton from '../components/GoogleButton'
import { signIn, signInWithGoogle } from '../lib/api'

export default function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={(e) => { e.preventDefault(); run(() => signIn({ email, password })) }}>
        <p className="brand-mark">PaddlePad<span>Admin</span></p>
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
        <div className="gate-or">or</div>
        <GoogleButton disabled={busy} label="Sign in with Google" onToken={(token) => run(() => signInWithGoogle(token))} />
        <p className="gate-note">Admin accounts are added by the owner. There is no sign-up here.</p>
      </form>
    </div>
  )
}
