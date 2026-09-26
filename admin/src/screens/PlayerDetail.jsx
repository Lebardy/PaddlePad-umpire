import { useEffect, useState } from 'react'
import AccountActions from '../components/AccountActions'
import ClaimCodeReveal from '../components/ClaimCodeReveal'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import StatusTag from '../components/StatusTag'
import { fetchPlayer, newClaimCode } from '../lib/api'
import { formatWhen, lastSignedInText, ratingText, signInMethodsText } from '../lib/format'
import { Link } from '../lib/router'

/** One player's page: their details, their recent matches, and what an admin can do about their account. */
export default function PlayerDetail({ id, me }) {
  // One result per id: whichever of player / notFound / error came back.
  // Comparing its id to the current prop (rather than resetting state
  // inside the effect) is what tells a still-loading id apart from one
  // already answered.
  const [result, setResult] = useState(null)
  const [claimCode, setClaimCode] = useState(null)

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

  // Pausing or closing wipes a revealed claim code's use -- it would
  // not work again until the account is active, so it must not keep
  // looking usable on screen.
  function handleChanged(fresh) {
    setResult({ id, player: fresh })
    setClaimCode(null)
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

  if (loading) return <section className="sheet"><p className="empty">Loading…</p></section>

  if (result.notFound) {
    return (
      <section className="sheet">
        <p className="empty missing">There’s no player here.</p>
        <p><Link to="/players" className="back-link">← Players</Link></p>
      </section>
    )
  }

  if (result.error) {
    return (
      <section className="sheet">
        <p className="form-error" role="alert">{result.error}</p>
        <p><Link to="/players" className="back-link">← Players</Link></p>
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
        <Link to="/players" className="back-link">← Players</Link>

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

        <AccountActions
          kind="players"
          person={player}
          me={me}
          onChanged={handleChanged}
          extraActions={(confirming, setConfirming) => (
            player.status !== 'paused' && (!player.closedByAdmin || me.role === 'owner') && (
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
            )
          )}
        />

        {claimCode && <ClaimCodeReveal code={claimCode} playerName={player.name} />}
      </div>
    </section>
  )
}
