import { useEffect, useState } from 'react'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import StatusTag from '../components/StatusTag'
import { closePerson, fetchUmpire, pausePerson, unpausePerson } from '../lib/api'
import { confirmNameMatches, formatWhen, lastSignedInText, signInMethodsText } from '../lib/format'
import { Link } from '../lib/router'

const inviteText = (invite) => (invite ? `${invite.code}${invite.note ? ` (${invite.note})` : ''}` : 'Unknown')
const matchStatusText = (status) => (status === 'completed' ? 'Finished' : 'In progress')

/** One umpire's page: their details, the matches they've scored, and what an admin can do about their account. */
export default function UmpireDetail({ id, me }) {
  // One result per id: whichever of umpire / notFound / error came back.
  // Comparing its id to the current prop (rather than resetting state
  // inside the effect) is what tells a still-loading id apart from one
  // already answered.
  const [result, setResult] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [reason, setReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [closeName, setCloseName] = useState('')
  const [closeError, setCloseError] = useState(null)
  const [closeBusy, setCloseBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetchUmpire(id)
      .then((u) => { if (live) setResult({ id, umpire: u }) })
      .catch((err) => {
        if (!live) return
        if (err.status === 404) setResult({ id, notFound: true })
        else setResult({ id, error: err.message })
      })
    return () => { live = false }
  }, [id])

  const loading = !result || result.id !== id
  const umpire = loading ? null : result.umpire

  async function handlePause() {
    const trimmed = reason.trim()
    if (!trimmed) throw new Error('Write a short reason (up to 300 characters)')
    const { umpire: fresh } = await pausePerson('umpires', id, trimmed)
    setResult({ id, umpire: fresh })
    setReason('')
  }

  async function handleUnpause() {
    const { umpire: fresh } = await unpausePerson('umpires', id)
    setResult({ id, umpire: fresh })
  }

  async function handleClose() {
    setCloseBusy(true)
    setCloseError(null)
    try {
      const { umpire: fresh } = await closePerson('umpires', id, { reason: closeReason.trim(), confirmName: closeName })
      setResult({ id, umpire: fresh })
      setClosing(false)
      setCloseReason('')
      setCloseName('')
    } catch (err) {
      setCloseError(err.message)
    } finally {
      setCloseBusy(false)
    }
  }

  if (loading) return <section className="sheet"><p className="empty">Loading…</p></section>

  if (result.notFound) {
    return (
      <section className="sheet">
        <p className="empty missing">There’s no umpire here.</p>
        <p><Link to="/people/umpires" className="back-link">← People</Link></p>
      </section>
    )
  }

  if (result.error) {
    return (
      <section className="sheet">
        <p className="form-error" role="alert">{result.error}</p>
        <p><Link to="/people/umpires" className="back-link">← People</Link></p>
      </section>
    )
  }

  return (
    <section>
      <PageBoard title={umpire.name} intro={<StatusTag status={umpire.status} />}>
        <div className="tally">
          <TallyCell figure={umpire.matchCount} label="Matches scored" />
          <TallyCell figure={umpire.matchesInProgress} label="Live now" />
        </div>
      </PageBoard>

      <div className="sheet">
        <Link to="/people/umpires" className="back-link">← People</Link>

        {umpire.status === 'paused' && (
          <p className="notice">Paused on {formatWhen(umpire.pausedAt)}: {umpire.pausedReason}</p>
        )}
        {umpire.status === 'closed' && (
          <p className="notice">Closed on {formatWhen(umpire.closedAt)}</p>
        )}

        <div>
          <h2 className="section-title">Details</h2>
          <div className="detail-facts" style={{ '--fact-columns': 3 }}>
            <div className="detail-fact"><span>Email</span><strong>{umpire.email}</strong></div>
            <div className="detail-fact"><span>Google</span><strong>{umpire.googleEmail ?? 'Not connected'}</strong></div>
            <div className="detail-fact"><span>Ways in</span><strong>{signInMethodsText(umpire.signInMethods)}</strong></div>
            <div className="detail-fact"><span>Joined</span><strong>{formatWhen(umpire.joinedAt)}</strong></div>
            <div className="detail-fact"><span>Last signed in</span><strong>{lastSignedInText(umpire.lastSignedInAt)}</strong></div>
            <div className="detail-fact"><span>Invite code</span><strong>{inviteText(umpire.invite)}</strong></div>
          </div>
        </div>

        <div>
          <h2 className="section-title">Recent matches scored</h2>
          {umpire.matches.length === 0 ? (
            <p className="empty">No matches scored yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-when">Date</th>
                    <th>Session</th>
                    <th>Team A</th>
                    <th>Team B</th>
                    <th>Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {umpire.matches.map((m) => (
                    <tr key={m.id}>
                      <td className="col-when">{formatWhen(m.startedAt)}</td>
                      <td>{m.sessionName}</td>
                      <td>{m.teamA.join(' & ')}</td>
                      <td>{m.teamB.join(' & ')}</td>
                      <td className="nowrap">{m.scoreA}–{m.scoreB}</td>
                      <td>{matchStatusText(m.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 className="section-title">Actions</h2>
          <div className="actions-row">
            {umpire.status !== 'closed' && umpire.status !== 'paused' && (
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

            {umpire.status === 'paused' && (
              <RowConfirm
                label="Switch back on"
                className="btn-quiet btn-small"
                question="They can sign in again straight away."
                confirmLabel="Switch back on"
                busyLabel="Switching…"
                confirmClass="btn-primary btn-small"
                open={confirming === 'unpause'}
                onOpen={() => setConfirming('unpause')}
                onClose={() => setConfirming(null)}
                onConfirm={handleUnpause}
              />
            )}

            {me.role === 'owner' && umpire.status !== 'closed' && !closing && (
              <button type="button" className="btn-danger btn-small" onClick={() => setClosing(true)}>Close for good</button>
            )}
          </div>

          {me.role === 'owner' && umpire.status !== 'closed' && closing && (
            <div className="panel">
              <p>
                Closing wipes their password and Google link and frees their email so they can sign up again with a
                new invite code. The matches they scored stay. This can’t be undone.
              </p>
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
                  disabled={closeBusy || !confirmNameMatches(closeName, umpire.name)}
                  onClick={handleClose}
                >
                  {closeBusy ? 'Closing…' : 'Close account'}
                </button>
                <button type="button" className="btn-quiet" onClick={() => { setClosing(false); setCloseError(null) }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
