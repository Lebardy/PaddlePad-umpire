import { useState } from 'react'
import { voidMatch } from '../lib/api'
import { useAutoDialog } from '../lib/useAutoDialog'

/** The warning pop-up for voiding a flagged match, opened from Worth a look. */
export default function VoidDialog({ warning, onCancel, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { ref, handleCancel } = useAutoDialog(onCancel, busy)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await voidMatch(warning.matchId, reason.trim())
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="warning-dialog" aria-labelledby="void-title" onCancel={handleCancel}>
      <h2 id="void-title" className="section-title">Void this match?</h2>
      <p>
        <strong>{warning.teamA.join(' & ')} vs {warning.teamB.join(' & ')}</strong> · {warning.sessionName} · {warning.reasons.map((r) => r.tag).join(', ')}
      </p>
      <p>
        It stops counting in these players’ stats and ratings. Nothing is deleted, and it can be undone.{' '}
        {warning.umpireName ?? 'The umpire'}, who scored it, will see that it was voided and why.
      </p>
      <label className="field">
        <span>Why (required)</span>
        <textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="panel-actions">
        <button type="button" className="btn-danger is-solid" disabled={busy || reason.trim() === ''} onClick={submit}>
          {busy ? 'Voiding…' : 'Void match'}
        </button>
        <button type="button" className="btn-quiet" disabled={busy} onClick={onCancel}>Not now</button>
      </div>
    </dialog>
  )
}
