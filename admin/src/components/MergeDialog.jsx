import { useState } from 'react'
import { mergePlayers } from '../lib/api'
import { confirmNameMatches, countWord } from '../lib/format'
import { useAutoDialog } from '../lib/useAutoDialog'

/** A player can't be kept as "removed" if they have signed in to the player app -- losing that sign-in isn't reversible. */
function initialKeepId(pair) {
  if (pair.a.hasSignIn !== pair.b.hasSignIn) return pair.a.hasSignIn ? pair.a.id : pair.b.id
  return pair.a.matchCount >= pair.b.matchCount ? pair.a.id : pair.b.id
}

/** One radio choice: keep this player, remove the other. */
function KeepChoice({ player, other, checked, onChange }) {
  const disabled = other.hasSignIn
  const detail = disabled
    ? 'can’t be removed: they’ve signed in to the player app'
    : `${countWord(player.matchCount, 'match', 'matches')} · ${player.hasSignIn ? 'has signed in to the player app' : 'hasn’t signed in'}`
  return (
    <label>
      <input type="radio" name="keep" checked={checked} disabled={disabled} onChange={onChange} />
      <span>
        <strong>Keep {player.name}</strong>
        <small>{detail}</small>
      </span>
    </label>
  )
}

/** The warning pop-up for merging two possibly-duplicate players, opened from Possible duplicate players. */
export default function MergeDialog({ pair, onCancel, onDone }) {
  const [keepId, setKeepId] = useState(() => initialKeepId(pair))
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { ref, handleCancel } = useAutoDialog(onCancel, busy)

  const removed = keepId === pair.a.id ? pair.b : pair.a

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await mergePlayers({ keepId, removeId: removed.id, confirmName: typed })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="warning-dialog" aria-labelledby="merge-title" onCancel={handleCancel}>
      <h2 id="merge-title" className="section-title">Merge {pair.a.name} and {pair.b.name}?</h2>
      <p>All matches move onto the one you keep. The other record is removed. <span className="warning-line">This can’t be undone.</span></p>
      <fieldset className="dlg-choice" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Which one to keep</legend>
        <KeepChoice player={pair.a} other={pair.b} checked={keepId === pair.a.id} onChange={() => setKeepId(pair.a.id)} />
        <KeepChoice player={pair.b} other={pair.a} checked={keepId === pair.b.id} onChange={() => setKeepId(pair.b.id)} />
      </fieldset>
      <p>Ratings catch up at the next nightly run. Type <strong>{removed.name}</strong> to confirm.</p>
      <label className="field">
        <span>Name of the record being removed</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="panel-actions">
        <button type="button" className="btn-danger is-solid" disabled={busy || !confirmNameMatches(typed, removed.name)} onClick={submit}>
          {busy ? 'Merging…' : 'Merge'}
        </button>
        <button type="button" className="btn-quiet" disabled={busy} onClick={onCancel}>Not now</button>
      </div>
    </dialog>
  )
}
