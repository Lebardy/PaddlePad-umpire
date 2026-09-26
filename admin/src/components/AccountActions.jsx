import { useEffect, useRef, useState } from 'react'
import RowConfirm from './RowConfirm'
import { closePerson, pausePerson, unpausePerson } from '../lib/api'
import { confirmNameMatches } from '../lib/format'

const CLOSE_EXPLANATION = {
  players:
    'Closing wipes their username, password, Google link and claim code. Their matches and rating history ' +
    'stay. A new claim code can reopen the account later.',
  umpires:
    'Closing wipes their password and Google link and frees their email so they can sign up again with a ' +
    'new invite code. The matches they scored stay.',
}

/**
 * Pause, resume and close: the actions shared by a
 * player's and an umpire's page. `extraActions`, given the same shared
 * `confirming` state this uses for Pause / Resume, can add
 * another row confirmation (the player's claim code) that takes part
 * in the same "only one open at a time" behaviour.
 */
export default function AccountActions({ kind, person, me, onChanged, extraActions }) {
  const singular = kind === 'players' ? 'player' : 'umpire'
  // Pausing a player stops them everywhere, since they belong to no
  // facility -- it stays the owner's alone. An umpire belongs to one
  // facility, so any admin who can see them may pause them.
  const canPause = kind === 'umpires' || me.role === 'owner'

  const [confirming, setConfirming] = useState(null)
  const [reason, setReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [closeName, setCloseName] = useState('')
  const [closeError, setCloseError] = useState(null)
  const [closeBusy, setCloseBusy] = useState(false)
  const closeDialog = useRef(null)

  // Closing can't be undone, so it asks in a pop-up over the page
  // rather than inline, where it is easy to click through.
  useEffect(() => {
    const dialog = closeDialog.current
    if (!dialog) return
    if (closing && !dialog.open) dialog.showModal()
    if (!closing && dialog.open) dialog.close()
  }, [closing])

  async function handlePause() {
    const trimmed = reason.trim()
    if (!trimmed) throw new Error('Write a short reason (up to 300 characters)')
    const data = await pausePerson(kind, person.id, trimmed)
    onChanged(data[singular])
    setReason('')
  }

  async function handleUnpause() {
    const data = await unpausePerson(kind, person.id)
    onChanged(data[singular])
  }

  async function handleClose() {
    setCloseBusy(true)
    setCloseError(null)
    try {
      const data = await closePerson(kind, person.id, { reason: closeReason.trim(), confirmName: closeName })
      onChanged(data[singular])
      setClosing(false)
      setCloseReason('')
      setCloseName('')
    } catch (err) {
      setCloseError(err.message)
    } finally {
      setCloseBusy(false)
    }
  }

  function cancelClose() {
    setClosing(false)
    setCloseError(null)
    setCloseReason('')
    setCloseName('')
  }

  return (
    <div>
      <h2 className="section-title">Actions</h2>
      <div className="actions-row">
        {canPause && person.status !== 'closed' && person.status !== 'paused' && (
          <RowConfirm
            label="Pause account"
            className="btn-danger btn-small"
            question={
              <span className="confirm-reason">
                <label className="field">
                  <span>Reason</span>
                  <textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                </label>
                <span className="hint">{reason.length}/300</span>
              </span>
            }
            confirmLabel="Pause"
            busyLabel="Pausing…"
            confirmClass="btn-danger is-solid btn-small"
            open={confirming === 'pause'}
            onOpen={() => setConfirming('pause')}
            onClose={() => setConfirming(null)}
            onConfirm={handlePause}
          />
        )}

        {canPause && person.status === 'paused' && (
          <RowConfirm
            label="Resume account"
            className="btn-quiet btn-small"
            question="They can sign in again straight away."
            confirmLabel="Resume"
            busyLabel="Resuming…"
            confirmClass="btn-primary btn-small"
            open={confirming === 'unpause'}
            onOpen={() => setConfirming('unpause')}
            onClose={() => setConfirming(null)}
            onConfirm={handleUnpause}
          />
        )}

        {extraActions?.(confirming, setConfirming)}

        {me.role === 'owner' && person.status !== 'closed' && !closing && (
          <button type="button" className="btn-danger btn-small" onClick={() => setClosing(true)}>Close</button>
        )}
      </div>

      {me.role === 'owner' && person.status !== 'closed' && (
        <dialog
          ref={closeDialog}
          className="warning-dialog"
          aria-labelledby="close-dialog-title"
          onCancel={(e) => { e.preventDefault(); if (!closeBusy) cancelClose() }}
        >
          <h2 id="close-dialog-title" className="section-title">Close {person.name}?</h2>
          <p className="warning-line">This can’t be undone.</p>
          <p>{CLOSE_EXPLANATION[kind]}</p>
          <label className="field"><span>Reason</span>
            <textarea value={closeReason} maxLength={300} onChange={(e) => setCloseReason(e.target.value)} />
          </label>
          <label className="field"><span>Type their name to confirm</span>
            <input value={closeName} onChange={(e) => setCloseName(e.target.value)} />
          </label>
          {closeError && <p className="form-error" role="alert">{closeError}</p>}
          <div className="panel-actions">
            <button
              type="button"
              className="btn-danger is-solid"
              disabled={closeBusy || !confirmNameMatches(closeName, person.name)}
              onClick={handleClose}
            >
              {closeBusy ? 'Closing…' : 'Close account'}
            </button>
            <button type="button" className="btn-quiet" disabled={closeBusy} onClick={cancelClose}>Cancel</button>
          </div>
        </dialog>
      )}
    </div>
  )
}
