import { useEffect, useState } from 'react'
import BackupCodes from '../components/BackupCodes'
import Gate from '../components/Gate'
import GoogleButton from '../components/GoogleButton'
import { completeSetup, makeBackupCodes, readSetupLink } from '../lib/api'

/** Where a setup link lands: choose a password or connect Google. */
export default function Setup({ secret, onSignedIn }) {
  const [link, setLink] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Set once setup itself is done, for the owner's one chance to save a
  // set of backup codes before the site shows. Other admins never see it.
  const [saved, setSaved] = useState(null)

  useEffect(() => {
    let live = true
    readSetupLink(secret)
      .then((data) => { if (live) setLink(data) })
      .catch((err) => { if (live) setLoadError(err.message) })
    return () => { live = false }
  }, [secret])

  async function finish(fields, proof) {
    setBusy(true)
    setError(null)
    try {
      const admin = await completeSetup(secret, fields)
      if (admin.role !== 'owner') {
        onSignedIn(admin)
        return
      }
      try {
        const { codes } = await makeBackupCodes(proof)
        setSaved({ admin, codes })
      } catch {
        // Setup itself worked; missing backup codes isn't a reason to
        // keep the owner out. Account shows they don't have any yet.
        onSignedIn(admin)
      }
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  function submitPassword(event) {
    event.preventDefault()
    if (password !== confirm) {
      setError('The two passwords don’t match.')
      return
    }
    finish({ password }, { currentPassword: password })
  }

  if (saved) {
    return (
      <Gate>
        <div className="gate-form">
          <h1>Save your backup codes</h1>
          <p>If you’re ever locked out, one of these signs you back in.</p>
          <BackupCodes codes={saved.codes} onDone={() => onSignedIn(saved.admin)} />
        </div>
      </Gate>
    )
  }

  if (loadError || !link) {
    return (
      <Gate>
        <div className="gate-form" role={loadError ? 'alert' : 'status'}>
          <h1>{loadError ? 'Link not working' : 'Checking your link'}</h1>
          <p>{loadError ?? 'One moment…'}</p>
        </div>
      </Gate>
    )
  }

  return (
    <Gate>
      <form className="gate-form" onSubmit={submitPassword}>
        <h1>Set up your account</h1>
        <p className="gate-for"><strong>{link.admin.name}</strong>{link.admin.email}</p>
        <p>This link works once.</p>
        <label className="field">
          <span>Choose a password</span>
          <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="field">
          <span>Type it again</span>
          <input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <p className="hint">At least 8 characters.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save password and sign in'}</button>
        {link.googleConfigured && (
          <GoogleButton withDivider disabled={busy} label="Continue with Google" onToken={(token) => finish({ accessToken: token }, { reproofAccessToken: token })} />
        )}
        <p className="gate-note">You can add the other way to sign in later, on your Account page.</p>
      </form>
    </Gate>
  )
}
