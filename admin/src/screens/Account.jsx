import { useState } from 'react'
import GoogleButton from '../components/GoogleButton'
import PageBoard from '../components/PageBoard'
import { changePassword, connectGoogle, disconnectGoogle, renameMe } from '../lib/api'
import { signInMethods } from '../lib/format'
import { THEMES, getThemeChoice, setThemeChoice } from '../lib/theme'

/** One section's saving state: a message, and whether it is an error. */
function useStatus() {
  const [status, setStatus] = useState(null)
  return [status, (message, isError = false) => setStatus(message ? { message, isError } : null)]
}

function Status({ status }) {
  if (!status) return null
  return <p className={status.isError ? 'form-error' : 'form-ok'} role={status.isError ? 'alert' : 'status'}>{status.message}</p>
}

/** A heading and a line about it on the left, the controls on the right. */
function Setting({ title, about, children, as: Tag = 'div', ...rest }) {
  return (
    <Tag className="setting" {...rest}>
      <div>
        <h2>{title}</h2>
        {about && <p className="setting-about">{about}</p>}
      </div>
      <div className="setting-body">{children}</div>
    </Tag>
  )
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
      <PageBoard title="Account" intro={<><strong>{admin.name}</strong> · {admin.email}</>}>
        <div className="facts">
          <div className="fact"><span className="tally-label">Role</span><strong>{admin.role === 'owner' ? 'Owner' : 'Admin'}</strong></div>
          <div className="fact"><span className="tally-label">Signs in with</span><strong>{signInMethods(admin)}</strong></div>
        </div>
      </PageBoard>

      <div className="sheet">
        <div className="settings">
          <Setting as="form" title="Your name" about="Shown at the top of every page and beside everything you do in Activity." onSubmit={saveName}>
            <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
            <Status status={nameStatus} />
            <button type="submit" className="btn-primary">Save name</button>
          </Setting>

          <Setting
            as="form"
            title={admin.hasPassword ? 'Change password' : 'Set a password'}
            about="At least 8 characters. There are no reset emails, so keep it somewhere safe."
            onSubmit={savePassword}
          >
            {admin.hasPassword && (
              <label className="field"><span>Current password</span>
                <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              </label>
            )}
            <div className="pair">
              <label className="field"><span>New password</span>
                <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </label>
              <label className="field"><span>Type it again</span>
                <input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </label>
            </div>
            <Status status={passwordStatus} />
            <button type="submit" className="btn-primary">Save password</button>
          </Setting>

          <Setting title="Google" about="Sign in with a Google account instead of typing a password.">
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
                <p>No Google account connected.</p>
                <Status status={googleStatus} />
                <GoogleButton label="Connect Google" onToken={(token) => runGoogle(() => connectGoogle(token), 'Google connected.')} />
              </>
            )}
          </Setting>

          <Setting title="Look" about="Only changes this computer.">
            <fieldset className="cells">
              <legend>Theme</legend>
              {THEMES.map((t) => (
                <label key={t.key}>
                  <input type="radio" name="theme" value={t.key} checked={theme === t.key}
                    onChange={() => { setTheme(t.key); setThemeChoice(t.key) }} />
                  {t.label}
                </label>
              ))}
            </fieldset>
          </Setting>
        </div>
      </div>
    </section>
  )
}
