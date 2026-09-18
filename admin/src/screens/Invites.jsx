import { useEffect, useRef, useState } from 'react'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import { cancelInvite, createInvite, listInvites } from '../lib/api'
import { EXPIRY_CHOICES, formatWhen, inviteStatusText, madeByText } from '../lib/format'

const SHOWING = [
  { key: 'all', label: 'All codes', empty: 'No invite codes yet. Make the first one above.' },
  { key: 'open', label: 'Open', empty: 'No open codes. Every code has been used, cancelled or has stopped working.' },
  { key: 'used', label: 'Used', empty: 'No code has been used yet.' },
  { key: 'expired', label: 'Expired', empty: 'No code has stopped working yet.' },
]

export default function Invites() {
  const [invites, setInvites] = useState(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [note, setNote] = useState('')
  const [expiry, setExpiry] = useState('14')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newest, setNewest] = useState(null)
  const [copied, setCopied] = useState(null)
  const [showing, setShowing] = useState('all')
  const [confirming, setConfirming] = useState(null)
  // Said after a code is cancelled. Its row is gone, so keyboard focus
  // comes here rather than falling back to the top of the page.
  const [cancelled, setCancelled] = useState(null)
  const cancelledNote = useRef(null)

  useEffect(() => {
    if (cancelled) cancelledNote.current?.focus()
  }, [cancelled])

  function loaded(rows) {
    setInvites(rows)
    setLoadedAt(Date.now())
    setError(null)
  }

  useEffect(() => {
    let live = true
    listInvites()
      .then((rows) => { if (live) loaded(rows) })
      .catch((err) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [])

  async function refresh() {
    try {
      loaded(await listInvites())
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setCancelled(null)
    try {
      const invite = await createInvite({
        note: note.trim() || undefined,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      })
      setNewest(invite.code)
      setNote('')
      if (showing !== 'open') show('all')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Errors are thrown back to the row's confirmation, which shows them there.
  async function handleCancel(code) {
    await cancelInvite(code)
    if (newest === code) setNewest(null)
    setCancelled({ code })
    await refresh()
  }

  function show(key) {
    setShowing(key)
    setConfirming(null)
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

  const counts = { all: invites?.length ?? 0, open: 0, used: 0, expired: 0 }
  for (const invite of invites ?? []) counts[invite.status] += 1
  const rows = (invites ?? []).filter((invite) => showing === 'all' || invite.status === showing)
  const current = SHOWING.find((s) => s.key === showing)
  const fresh = newest && invites?.find((invite) => invite.code === newest)

  return (
    <section>
      <PageBoard
        title="Invite codes"
        intro="A new umpire needs a code to create their account. Each code works once. Send it to them yourself."
      >
        <div className="tally" role="group" aria-label="Show codes">
          {SHOWING.map((s) => (
            <TallyCell key={s.key} figure={invites ? counts[s.key] : '–'} label={s.label}
              pressed={showing === s.key} onClick={() => show(s.key)} />
          ))}
        </div>
      </PageBoard>

      <div className="sheet">
        <form className="form-strip" onSubmit={handleCreate}>
          <h2 className="form-strip-title">New code</h2>
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

        {fresh && (
          <div className="ticket board-texture" role="status">
            <div>
              <p className="ticket-code">{fresh.code}</p>
              <p className="ticket-text">
                {fresh.note ? <>For <strong>{fresh.note}</strong> · </> : null}
                {inviteStatusText(fresh, loadedAt)}. Send it to them yourself. It works once.
              </p>
            </div>
            <div className="ticket-actions">
              <button type="button" className="btn-lamp" onClick={() => handleCopy(fresh.code)}>
                {copied === fresh.code ? 'Copied' : 'Copy code'}
              </button>
              <button type="button" className="btn-board" onClick={() => setNewest(null)}>Done</button>
            </div>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        {invites === null && !error && <p className="empty">Loading…</p>}
        {cancelled && (
          <p className="form-ok" role="status" tabIndex={-1} ref={cancelledNote}>
            Cancelled {cancelled.code}. It no longer works.
          </p>
        )}
        {invites && rows.length === 0 && (
          <p className="empty">{invites.length === 0 ? SHOWING.find((s) => s.key === 'all').empty : current.empty}</p>
        )}

        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="col-code">Code</th>
                  <th>For</th>
                  <th>Status</th>
                  <th className="col-when">Made</th>
                  <th className="col-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invite) => (
                  <tr key={invite.code} className={[invite.status !== 'open' && 'is-faded', newest === invite.code && 'is-new'].filter(Boolean).join(' ')}>
                    <td className="col-code"><span className="code">{invite.code}</span></td>
                    <td>
                      <span className="cell-main">{invite.note ?? '—'}</span>
                      {invite.created_by_name && <span className="cell-sub">Made by {madeByText(invite)}</span>}
                    </td>
                    <td>
                      <span className={`tag tag-${invite.status}`}>{inviteStatusText(invite, loadedAt)}</span>
                      {invite.status === 'used' && invite.used_at && <span className="cell-sub nowrap">{formatWhen(invite.used_at)}</span>}
                    </td>
                    <td className="col-when">{formatWhen(invite.created_at)}</td>
                    <td className="row-actions">
                      {invite.status === 'open' && (
                        <>
                          {confirming !== invite.code && (
                            <button type="button" className="btn-quiet btn-small" onClick={() => handleCopy(invite.code)}>{copied === invite.code ? 'Copied' : 'Copy'}</button>
                          )}
                          <RowConfirm
                            label="Cancel"
                            className="btn-danger btn-small"
                            question="It stops working straight away."
                            confirmLabel="Cancel code"
                            busyLabel="Cancelling…"
                            confirmClass="btn-danger is-solid btn-small"
                            open={confirming === invite.code}
                            onOpen={() => { setCancelled(null); setConfirming(invite.code) }}
                            onClose={() => setConfirming(null)}
                            onConfirm={() => handleCancel(invite.code)}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
