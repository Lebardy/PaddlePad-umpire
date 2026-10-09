import { useEffect, useState } from 'react'
import BackupCodes from '../components/BackupCodes'
import GoogleButton from '../components/GoogleButton'
import PageBoard from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import {
  changePassword,
  connectGoogle,
  disconnectGoogle,
  fetchMeWithCodes,
  makeBackupCodes,
  renameMe,
  signOutOthers,
} from '../lib/api'
import { signInMethods } from '../lib/format'
import { THEMES, getThemeChoice, setThemeChoice } from '../lib/theme'

const USED_BACKUP_CODE_NOTICE =
  "You signed in with a backup code. Set a new password or reconnect Google, then make new backup codes if you’re running low."

/** One section's saving state: a message, whether it's an error, and
    whether its request is running right now. */
function useStatus() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  function setMessage(message, isError = false) {
    setStatus(message ? { message, isError } : null)
  }

  async function run(action, doneMessage) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await action()
      setMessage(doneMessage)
      return result
    } catch (err) {
      setMessage(err.message, true)
      throw err
    } finally {
      setBusy(false)
    }
  }

  return [status, setMessage, busy, run]
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

/** Proof that whoever is making a sign-in change is really this admin:
    their current password, or -- when they have none -- a fresh Google
    sign-in done again right now. `bypass` skips both: the session itself
    already proved it, because it was opened with a backup code (see
    requireReproof / proofFromSession on the server). */
function useProof(admin, bypass = false) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [reproofToken, setReproofToken] = useState(null)
  const ready = bypass || (admin.hasPassword ? currentPassword.length > 0 : Boolean(reproofToken))
  const proof = bypass ? {} : (admin.hasPassword ? { currentPassword } : { reproofAccessToken: reproofToken })
  function reset() {
    setCurrentPassword('')
    setReproofToken(null)
  }
  return { currentPassword, setCurrentPassword, reproofToken, setReproofToken, ready, proof, reset }
}

function ProofField({ admin, proof, busy, bypass }) {
  if (bypass) return <p className="form-ok" role="status">Confirmed by your backup-code sign-in.</p>
  if (admin.hasPassword) {
    return (
      <label className="field"><span>Current password</span>
        <input type="password" autoComplete="current-password" value={proof.currentPassword}
          onChange={(e) => proof.setCurrentPassword(e.target.value)} required />
      </label>
    )
  }
  if (proof.reproofToken) return <p className="form-ok" role="status">Confirmed with Google.</p>
  return <GoogleButton label="Confirm with Google" disabled={busy} onToken={proof.setReproofToken} />
}

export default function Account({ admin, onAdminChange }) {
  const [name, setName] = useState(admin.name)
  const [nameStatus, , nameBusy, runName] = useStatus()

  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordStatus, setPasswordStatus, passwordBusy, runPassword] = useStatus()

  const [googleStatus, , googleBusy, runGoogle] = useStatus()

  const [sessionsStatus, , sessionsBusy, runSessions] = useStatus()

  const [codes, setCodes] = useState(null)
  const [backupCodesLeft, setBackupCodesLeft] = useState(null)
  const [backupCodesLoaded, setBackupCodesLoaded] = useState(false)
  const [askingNewCodes, setAskingNewCodes] = useState(false)
  const [codesStatus, , codesBusy, runCodes] = useStatus()

  const [theme, setTheme] = useState(getThemeChoice)
  // Whether this session still counts as its own proof (see
  // requireReproof / proofFromSession on the server): true from a
  // backup-code sign-in until the first sign-in change goes through, at
  // which point the fresh token it comes back with drops the claim.
  // Always read from the server, never guessed from something the
  // browser remembers -- fetched below on every mount, and kept in step
  // by every response that mints a fresh token, so it survives a reload
  // and clears itself the moment "Sign out everywhere else" (or any
  // other change) takes it away.
  const [viaBackupCode, setViaBackupCode] = useState(false)

  const passwordProof = useProof(admin, viaBackupCode)
  const googleProof = useProof(admin, viaBackupCode)
  const codesProof = useProof(admin, viaBackupCode)

  useEffect(() => {
    let live = true
    fetchMeWithCodes()
      .then((data) => {
        if (!live) return
        setBackupCodesLeft(data.backupCodesLeft)
        setBackupCodesLoaded(true)
        setViaBackupCode(Boolean(data.viaBackupCode))
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  async function saveName(event) {
    event.preventDefault()
    try {
      onAdminChange(await runName(() => renameMe(name.trim()), 'Name saved.'))
    } catch {
      // Status already shown by runName.
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    if (newPassword !== confirm) {
      setPasswordStatus('The two new passwords don’t match.', true)
      return
    }
    try {
      const { admin: updated, viaBackupCode: stillVia } = await runPassword(
        () => changePassword({ proof: passwordProof.proof, newPassword }), 'Password saved.')
      onAdminChange(updated)
      setNewPassword('')
      setConfirm('')
      passwordProof.reset()
      setViaBackupCode(Boolean(stillVia))
    } catch {
      // Status already shown by runPassword.
    }
  }

  async function saveConnectGoogle(accessToken) {
    try {
      const { admin: updated, viaBackupCode: stillVia } = await runGoogle(
        () => connectGoogle(accessToken, googleProof.proof), 'Google connected.')
      onAdminChange(updated)
      googleProof.reset()
      setViaBackupCode(Boolean(stillVia))
    } catch {
      // Status already shown by runGoogle.
    }
  }

  async function saveDisconnectGoogle() {
    try {
      const { admin: updated, viaBackupCode: stillVia } = await runGoogle(
        () => disconnectGoogle(googleProof.proof), 'Google disconnected.')
      onAdminChange(updated)
      googleProof.reset()
      setViaBackupCode(Boolean(stillVia))
    } catch {
      // Status already shown by runGoogle.
    }
  }

  async function signOutEverywhereElse() {
    try {
      const { admin: updated, viaBackupCode: stillVia } = await runSessions(() => signOutOthers(), 'Signed out everywhere else.')
      onAdminChange(updated)
      setViaBackupCode(Boolean(stillVia))
    } catch {
      // Status already shown by runSessions.
    }
  }

  async function makeNewCodes() {
    try {
      const { codes: newCodes, viaBackupCode: stillVia } = await runCodes(() => makeBackupCodes(codesProof.proof))
      setCodes(newCodes)
      setBackupCodesLeft(newCodes.length)
      codesProof.reset()
      setViaBackupCode(Boolean(stillVia))
    } catch {
      // Status already shown by runCodes.
    }
  }

  const codesGone = backupCodesLeft === 0 || backupCodesLeft == null

  return (
    <section>
      {viaBackupCode && <p className="notice" role="status">{USED_BACKUP_CODE_NOTICE}</p>}
      <PageBoard title="Account" intro={<><strong>{admin.name}</strong> · {admin.email}</>}>
        <div className="facts">
          <div className="fact"><span className="tally-label">Role</span><strong>{admin.role === 'owner' ? 'Owner' : 'Admin'}</strong></div>
          <div className="fact"><span className="tally-label">Signs in with</span><strong>{signInMethods(admin)}</strong></div>
        </div>
      </PageBoard>

      <div className="sheet">
        <div className="settings">
          <Setting as="form" title="Your name" about="Shown on every page and beside what you do in Activity." onSubmit={saveName}>
            <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
            <Status status={nameStatus} />
            <button type="submit" className="btn-primary" disabled={nameBusy}>{nameBusy ? 'Saving…' : 'Save name'}</button>
          </Setting>

          <Setting
            as="form"
            title={admin.hasPassword ? 'Change password' : 'Set a password'}
            about="At least 8 characters. There are no reset emails."
            onSubmit={savePassword}
          >
            <ProofField admin={admin} proof={passwordProof} busy={passwordBusy} bypass={viaBackupCode} />
            <div className="pair">
              <label className="field"><span>New password</span>
                <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
              </label>
              <label className="field"><span>Type it again</span>
                <input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </label>
            </div>
            <Status status={passwordStatus} />
            <button type="submit" className="btn-primary" disabled={passwordBusy || !passwordProof.ready}>
              {passwordBusy ? 'Saving…' : 'Save password'}
            </button>
          </Setting>

          <Setting title="Google" about="Sign in with Google instead of a password.">
            {admin.googleEmail ? (
              <>
                <p>Connected to <strong>{admin.googleEmail}</strong>.</p>
                {!admin.hasPassword && <p className="hint">Set a password before disconnecting. Google is your only way in.</p>}
                {admin.hasPassword && <ProofField admin={admin} proof={googleProof} busy={googleBusy} bypass={viaBackupCode} />}
                <Status status={googleStatus} />
                <button type="button" className="btn-danger" disabled={googleBusy || !admin.hasPassword || !googleProof.ready}
                  onClick={saveDisconnectGoogle}>{googleBusy ? 'Saving…' : 'Disconnect Google'}</button>
              </>
            ) : (
              <>
                <p>No Google account connected.</p>
                <ProofField admin={admin} proof={googleProof} busy={googleBusy} bypass={viaBackupCode} />
                <Status status={googleStatus} />
                <GoogleButton label={googleBusy ? 'Saving…' : 'Connect Google'} disabled={googleBusy || !googleProof.ready}
                  onToken={saveConnectGoogle} />
              </>
            )}
          </Setting>

          <Setting title="Sessions" about="Signs you out of every other browser. You stay signed in here.">
            <Status status={sessionsStatus} />
            <button type="button" className="btn-quiet" disabled={sessionsBusy} onClick={signOutEverywhereElse}>
              {sessionsBusy ? 'Saving…' : 'Sign out everywhere else'}
            </button>
          </Setting>

          {admin.role === 'owner' && (
            <Setting title="Backup codes" about="A way back in if you lose both your password and Google.">
              {backupCodesLoaded && (
                codesGone
                  ? <p>You don’t have backup codes yet.</p>
                  : (
                    <>
                      <p>You have {backupCodesLeft} backup code{backupCodesLeft === 1 ? '' : 's'} left.</p>
                      {backupCodesLeft <= 3 && <p className="notice">Running low. Make a new set.</p>}
                    </>
                  )
              )}
              {askingNewCodes && <ProofField admin={admin} proof={codesProof} busy={codesBusy} bypass={viaBackupCode} />}
              <Status status={codesStatus} />
              <RowConfirm
                label="Make new backup codes"
                className="btn-primary"
                question="Your old codes stop working."
                confirmLabel="Make new codes"
                busyLabel="Making…"
                confirmClass="btn-primary"
                keepLabel="Not now"
                open={askingNewCodes}
                disabled={askingNewCodes && !codesProof.ready}
                onOpen={() => setAskingNewCodes(true)}
                onClose={() => setAskingNewCodes(false)}
                onConfirm={makeNewCodes}
              />
              {codes && <BackupCodes codes={codes} onDone={() => setCodes(null)} />}
            </Setting>
          )}

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
