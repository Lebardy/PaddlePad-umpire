import { useEffect, useState } from 'react'
import ClaimCodeReveal from '../components/ClaimCodeReveal'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import StatusTag from '../components/StatusTag'
import { closePerson, fetchPlayer, newClaimCode, pausePerson, unpausePerson } from '../lib/api'
import { confirmNameMatches, formatWhen, lastSignedInText, ratingText, signInMethodsText } from '../lib/format'
import { Link } from '../lib/router'

/** One player's page: their details, their recent matches, and what an admin can do about their account. */
export default function PlayerDetail({ id, me }) {
  // One result per id: whichever of player / notFound / error came back.
  // Comparing its id to the current prop (rather than resetting state
  // inside the effect) is what tells a still-loading id apart from one
  // already answered.
  const [result, setResult] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [reason, setReason] = useState('')
  const [claimCode, setClaimCode] = useState(null)
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [closeName, setCloseName] = useState('')
  const [closeError, setCloseError] = useState(null)
  const [closeBusy, setCloseBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetchPlayer(id)
      .then((p) => { if (live) setResult({ id, player: p }) })
      .catch((err) => {
        if (!live) return
        if (err.status === 404) setResult({ id, notFound: true })
        else setResult({ id, error: err.message })
      })
    return () => { live = false }
  }, [id])

  const loading = !result || result.id !== id
  const player = loading ? null : result.player

  async function handlePause() {
    const trimmed = reason.trim()
    if (!trimmed) throw new Error('Write a short reason (up to 300 characters)')
    const { player: fresh } = await pausePerson('players', id, trimmed)
    setResult({ id, player: fresh })
    setReason('')
    // A code revealed earlier would not work again until they are
    // switched back on, so it must not keep looking usable on screen.
    setClaimCode(null)
  }

  async function handleUnpause() {
    const { player: fresh } = await unpausePerson('players', id)
    setResult({ id, player: fresh })
  }

  async function handleClaimCode() {
    const code = await newClaimCode(id)
    // Shown right away: the code already exists server-side and has
    // already replaced any old one, so a failed refetch below must
    // never hide it.
    setClaimCode(code)
    // "Ways in" changes the moment a code exists, so the page must not
    // keep showing the stale answer until the next reload.
    const fresh = await fetchPlayer(id)
    setResult({ id, player: fresh })
  }

  async function handleClose() {
    setCloseBusy(true)
    setCloseError(null)
    try {
      const { player: fresh } = await closePerson('players', id, { reason: closeReason.trim(), confirmName: closeName })
      setResult({ id, player: fresh })
      setClosing(false)
      setCloseReason('')
      setCloseName('')
      // Closing wipes the claim code, so a previously revealed one is
      // stale the moment this succeeds.
      setClaimCode(null)
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
        <p className="empty missing">There’s no player here.</p>
        <p><Link to="/people" className="back-link">← People</Link></p>
      </section>
    )
  }

  if (result.error) {
    return (
      <section className="sheet">
        <p className="form-error" role="alert">{result.error}</p>
        <p><Link to="/people" className="back-link">← People</Link></p>
      </section>
    )
  }

  return (
    <section>
      <PageBoard title={player.name} intro={<StatusTag status={player.status} />}>
        <div className="tally">
          <TallyCell figure={player.matchCount} label="Matches" />
          <TallyCell figure={player.matchesInProgress} label="Live now" />
          <TallyCell figure={ratingText(player.rating)} label="Rating" variant="text" />
        </div>
      </PageBoard>

      <div className="sheet">
        <Link to="/people" className="back-link">← People</Link>

        {player.status === 'paused' && (
          <p className="notice">Paused on {formatWhen(player.pausedAt)}: {player.pausedReason}</p>
        )}
        {player.status === 'closed' && (
          <p className="notice">Closed on {formatWhen(player.closedAt)}</p>
        )}

        <div>
          <h2 className="section-title">Details</h2>
          <div className="detail-facts">
            <div className="detail-fact"><span>Username</span><strong>{player.username ?? 'None'}</strong></div>
            <div className="detail-fact"><span>Google</span><strong>{player.googleEmail ?? 'Not connected'}</strong></div>
            <div className="detail-fact"><span>Ways in</span><strong>{signInMethodsText(player.signInMethods)}</strong></div>
            <div className="detail-fact"><span>Claimed</span><strong>{player.claimed ? 'Yes' : 'No'}</strong></div>
            <div className="detail-fact"><span>On the board</span><strong>{player.hiddenFromBoard ? 'Hidden by them' : 'Shown'}</strong></div>
            <div className="detail-fact"><span>Joined</span><strong>{formatWhen(player.joinedAt)}</strong></div>
            <div className="detail-fact"><span>Last signed in</span><strong>{lastSignedInText(player.lastSignedInAt)}</strong></div>
            <div className="detail-fact"><span>Added by</span><strong>{player.createdBy ?? 'Signed up themselves'}</strong></div>
          </div>
        </div>

        <div>
          <h2 className="section-title">Recent matches</h2>
          {player.matches.length === 0 ? (
            <p className="empty">No finished matches yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-when">Date</th>
                    <th>Session</th>
                    <th>With</th>
                    <th>Against</th>
                    <th>Score</th>
                    <th>Result</th>
                    <th>Scored by</th>
                  </tr>
                </thead>
                <tbody>
                  {player.matches.map((m) => (
                    <tr key={m.id}>
                      <td className="col-when">{formatWhen(m.endedAt)}</td>
                      <td>{m.sessionName}</td>
                      <td>{m.isDoubles ? m.partner : 'Singles'}</td>
                      <td>{m.opponents.join(' & ')}</td>
                      <td className="nowrap">{m.yourScore}–{m.theirScore}</td>
                      <td>{m.won === null ? '—' : (m.won ? 'Won' : 'Lost')}</td>
                      <td>{m.scoredBy}</td>
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
            {player.status !== 'closed' && player.status !== 'paused' && (
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

            {player.status === 'paused' && (
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

            {player.status !== 'paused' && (!player.closedByAdmin || me.role === 'owner') && (
              <RowConfirm
                label="New claim code"
                className="btn-quiet btn-small"
                question={player.status === 'closed' ? 'Claiming it will reopen their account.' : 'The old code will stop working.'}
                confirmLabel="Make code"
                busyLabel="Making…"
                confirmClass="btn-primary btn-small"
                open={confirming === 'claim'}
                onOpen={() => setConfirming('claim')}
                onClose={() => setConfirming(null)}
                onConfirm={handleClaimCode}
              />
            )}

            {me.role === 'owner' && player.status !== 'closed' && !closing && (
              <button type="button" className="btn-danger btn-small" onClick={() => setClosing(true)}>Close for good</button>
            )}
          </div>

          {me.role === 'owner' && player.status !== 'closed' && closing && (
            <div className="panel">
              <p>
                Closing wipes their username, password, Google link and claim code. Their matches and rating history
                stay. This can’t be undone, but a new claim code can reopen the account.
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
                  disabled={closeBusy || !confirmNameMatches(closeName, player.name)}
                  onClick={handleClose}
                >
                  {closeBusy ? 'Closing…' : 'Close account'}
                </button>
                <button type="button" className="btn-quiet" onClick={() => { setClosing(false); setCloseError(null) }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {claimCode && <ClaimCodeReveal code={claimCode} playerName={player.name} />}
      </div>
    </section>
  )
}
