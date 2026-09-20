import { useState } from 'react'
import { closeSession } from '../lib/api'
import { countWord } from '../lib/format'
import { useAutoDialog } from '../lib/useAutoDialog'

/**
 * The warning pop-up for closing a session an umpire left open, opened
 * from Worth a look. Unlike Void, there's no Undo here -- reopening a
 * session is the umpire's own call, from their app.
 */
export default function CloseSessionDialog({ session, onCancel, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { ref, handleCancel } = useAutoDialog(onCancel, busy)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await closeSession(session.sessionId, reason.trim())
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="warning-dialog" aria-labelledby="close-session-title" onCancel={handleCancel}>
      <h2 id="close-session-title" className="section-title">Close this session?</h2>
      <p>
        <strong>{session.name}</strong> · opened by {session.openedBy} · {countWord(session.playerCount, 'player', 'players')} on the list · {session.tag}
      </p>
      <p>
        It’s been left open, so closing it tidies up the list. Matches inside it aren’t touched — a match still in
        progress stays with the umpire who scored it. The umpire can reopen the session from their app.
      </p>
      <label className="field">
        <span>Why (required)</span>
        <textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="panel-actions">
        <button type="button" className="btn-danger is-solid" disabled={busy || reason.trim() === ''} onClick={submit}>
          {busy ? 'Closing…' : 'Close session'}
        </button>
        <button type="button" className="btn-quiet" disabled={busy} onClick={onCancel}>Not now</button>
      </div>
    </dialog>
  )
}
