import { useEffect, useState } from 'react'
import { cancelInvite, createInvite, listInvites } from '../lib/api'
import { EXPIRY_CHOICES, formatWhen, inviteStatusText, madeByText } from '../lib/format'

export default function Invites() {
  const [invites, setInvites] = useState(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [note, setNote] = useState('')
  const [expiry, setExpiry] = useState('14')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newest, setNewest] = useState(null)
  const [copied, setCopied] = useState(null)

  async function refresh() {
    try {
      const rows = await listInvites()
      setInvites(rows)
      setLoadedAt(Date.now())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { refresh() }, [])

  async function handleCreate(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const invite = await createInvite({
        note: note.trim() || undefined,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      })
      setNewest(invite.code)
      setNote('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel(code) {
    if (!window.confirm(`Cancel invite code ${code}? It stops working straight away.`)) return
    try {
      await cancelInvite(code)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  // The clipboard can be blocked; then the code stays on screen to copy by hand.
  async function handleCopy(code) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError(`Couldn’t copy automatically. Select ${code} and copy it by hand.`)
    }
  }

  return (
    <section>
      <header className="page-head">
        <h1>Invite codes</h1>
        <p>A new umpire needs a code to create their account. Each code works once. Send it to them yourself.</p>
      </header>

      <form className="toolbar" onSubmit={handleCreate}>
        <label className="field grow">
          <span>Who it’s for (optional)</span>
          <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Coach Ana" />
        </label>
        <label className="field">
          <span>Stops working</span>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Making…' : 'Make a code'}</button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {invites === null && !error && <p className="empty">Loading…</p>}
      {invites?.length === 0 && <p className="empty">No invite codes yet.</p>}

      {invites?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Code</th><th>For</th><th>Status</th><th>Made by</th><th>Made</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.code} className={[invite.status !== 'open' && 'is-faded', newest === invite.code && 'is-new'].filter(Boolean).join(' ')}>
                  <td><span className="code">{invite.code}</span></td>
                  <td>{invite.note ?? '—'}</td>
                  <td>
                    <span className={`tag tag-${invite.status}`}>{inviteStatusText(invite, loadedAt)}</span>
                    {invite.status === 'used' && invite.used_at && <span className="hint"> {formatWhen(invite.used_at)}</span>}
                  </td>
                  <td>{madeByText(invite)}</td>
                  <td>{formatWhen(invite.created_at)}</td>
                  <td className="row-actions">
                    {invite.status === 'open' && (
                      <>
                        <button type="button" className="btn-quiet" onClick={() => handleCopy(invite.code)}>{copied === invite.code ? 'Copied' : 'Copy'}</button>
                        <button type="button" className="btn-danger" onClick={() => handleCancel(invite.code)}>Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
