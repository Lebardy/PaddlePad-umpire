import { useEffect, useState } from 'react'
import { createInvite, listInvites, revokeInvite } from '../lib/api'

// Where an existing umpire creates a code for a new one. Registration
// is invite-only (the API is public), so this is the only route into
// the app for a new umpire.
function Invites({ onBack }) {
  const [invites, setInvites] = useState([])
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(null)

  // "Expires in N days" is computed once when the list arrives rather
  // than during render: reading the clock while rendering makes the
  // output depend on when React happens to re-render.
  function withCountdown(rows) {
    const now = Date.now()
    return rows.map((invite) => ({
      ...invite,
      daysLeft: invite.expires_at
        ? Math.ceil((new Date(invite.expires_at) - now) / 86_400_000)
        : null,
    }))
  }

  async function refresh({ signal } = {}) {
    try {
      const rows = await listInvites()
      if (signal?.aborted) return
      setInvites(withCountdown(rows))
      setError(null)
    } catch (err) {
      if (signal?.aborted) return
      setError(err.message)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    // Guards against setting state after the screen has been left --
    // otherwise navigating away mid-request warns and leaks.
    const controller = new AbortController()
    // refresh is async and every setState in it runs after an await, so
    // nothing is set synchronously here; the linter can't see through
    // the async boundary. Fetching on mount is the intended use of an
    // effect ("synchronizing with an external system" — the API).
    // eslint-disable-next-line react/set-state-in-effect
    refresh({ signal: controller.signal })
    return () => controller.abort()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createInvite({ note: note.trim() || undefined })
      setNote('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(code) {
    if (!confirm(`Revoke invite ${code}? It will stop working immediately.`)) return
    try {
      await revokeInvite(code)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  // The clipboard API needs a secure context and can be blocked, so a
  // failure falls back to leaving the code visible to copy by hand
  // rather than pretending it worked.
  async function handleCopy(code) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(code)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError(`Couldn't copy automatically — select and copy ${code} manually.`)
    }
  }

  function describeExpiry(invite) {
    if (invite.status === 'used') {
      return `Used${invite.used_by_name ? ` by ${invite.used_by_name}` : ''}`
    }
    if (invite.status === 'expired') return 'Expired'
    if (invite.daysLeft === null) return 'No expiry'
    const days = invite.daysLeft
    return `Expires in ${days} day${days === 1 ? '' : 's'}`
  }

  return (
    <div className="invites">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h2>Invites</h2>
      <p className="login-note">
        New umpires can only sign up with a code. Each code works once and
        expires after 14 days.
      </p>

      <form className="new-session-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Who's it for? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'New code'}
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}

      {loading && <p className="empty">Loading…</p>}
      {!loading && invites.length === 0 && (
        <p className="empty">No invites yet.</p>
      )}

      <ul className="invite-list">
        {invites.map((invite) => (
          <li key={invite.code} className={`invite-item ${invite.status}`}>
            <div className="invite-main">
              <code className="invite-code">{invite.code}</code>
              <span className={`invite-status ${invite.status}`}>
                {describeExpiry(invite)}
              </span>
            </div>
            {invite.note && <p className="invite-note">{invite.note}</p>}
            {invite.status === 'open' && (
              <div className="invite-actions">
                <button onClick={() => handleCopy(invite.code)}>
                  {copied === invite.code ? 'Copied' : 'Copy'}
                </button>
                <button
                  className="remove"
                  onClick={() => handleRevoke(invite.code)}
                >
                  Revoke
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Invites
