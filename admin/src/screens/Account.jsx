import { useState } from 'react'
import GoogleButton from '../components/GoogleButton'
import { changePassword, connectGoogle, disconnectGoogle, renameMe } from '../lib/api'
import { THEMES, getThemeChoice, setThemeChoice } from '../lib/theme'

/** One panel's saving state: a message, and whether it is an error. */
function useStatus() {
  const [status, setStatus] = useState(null)
  return [status, (message, isError = false) => setStatus(message ? { message, isError } : null)]
}

function Status({ status }) {
  if (!status) return null
  return <p className={status.isError ? 'form-error' : 'form-ok'} role={status.isError ? 'alert' : 'status'}>{status.message}</p>
}

export default function Account({ admin, onAdminChange }) {
  const [name, setName] = useState(admin.name)
  const [nameStatus, setNameStatus] = useStatus()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordStatus, setPasswordStatus] = useStatus()
  const [googleStatus, setGoogleStatus] = useStatus()
  const [theme, setTheme] = useState(getThemeChoice)

  async function saveName(event) {
    event.preventDefault()
    try {
      onAdminChange(await renameMe(name.trim()))
      setNameStatus('Name saved.')
    } catch (err) {
      setNameStatus(err.message, true)
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    if (newPassword !== confirm) {
      setPasswordStatus('The two new passwords don’t match.', true)
      return
    }
    try {
      onAdminChange(await changePassword({ currentPassword, newPassword }))
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      setPasswordStatus('Password saved.')
    } catch (err) {
      setPasswordStatus(err.message, true)
    }
  }

  async function runGoogle(action, done) {
    try {
      onAdminChange(await action())
      setGoogleStatus(done)
    } catch (err) {
      setGoogleStatus(err.message, true)
    }
  }

  return (
    <section>
      <header className="page-head">
        <h1>Account</h1>
        <p>{admin.email} · {admin.role === 'owner' ? 'Owner' : 'Admin'}</p>
      </header>

      <div className="panel-grid">
        <form className="panel" onSubmit={saveName}>
          <h2>Your name</h2>
          <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
          <Status status={nameStatus} />
          <button type="submit" className="btn-primary">Save name</button>
        </form>

        <form className="panel" onSubmit={savePassword}>
          <h2>{admin.hasPassword ? 'Change password' : 'Set a password'}</h2>
          {admin.hasPassword && (
            <label className="field"><span>Current password</span>
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </label>
          )}
          <label className="field"><span>New password</span>
            <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </label>
          <label className="field"><span>Type it again</span>
            <input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          <Status status={passwordStatus} />
          <button type="submit" className="btn-primary">Save password</button>
        </form>

        <div className="panel">
          <h2>Google</h2>
          {admin.googleEmail ? (
            <>
              <p>Connected to <strong>{admin.googleEmail}</strong>.</p>
              {!admin.hasPassword && <p className="hint">Set a password before disconnecting. Google is your only way in.</p>}
              <Status status={googleStatus} />
              <button type="button" className="btn-danger" disabled={!admin.hasPassword}
                onClick={() => runGoogle(disconnectGoogle, 'Google disconnected.')}>Disconnect Google</button>
            </>
          ) : (
            <>
              <p>Connect a Google account to sign in without a password.</p>
              <Status status={googleStatus} />
              <GoogleButton label="Connect Google" onToken={(token) => runGoogle(() => connectGoogle(token), 'Google connected.')} />
            </>
          )}
        </div>

        <div className="panel">
          <h2>Look</h2>
          <label className="field"><span>Theme</span>
            <select value={theme} onChange={(e) => { setTheme(e.target.value); setThemeChoice(e.target.value) }}>
              {THEMES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
        </div>
      </div>
    </section>
  )
}
