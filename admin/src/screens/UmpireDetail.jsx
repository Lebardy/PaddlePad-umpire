import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import AccountActions from '../components/AccountActions'
import FacilityPicker from '../components/FacilityPicker'
import PageBoard, { TallyCell } from '../components/PageBoard'
import RowConfirm from '../components/RowConfirm'
import StatusTag from '../components/StatusTag'
import { fetchUmpire, moveUmpire } from '../lib/api'
import { formatWhen, lastSignedInText, signInMethodsText } from '../lib/format'
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
  const [moveFacilityId, setMoveFacilityId] = useState('')

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

  function handleChanged(fresh) {
    setResult({ id, umpire: fresh })
  }

  // Errors are thrown back to the row's confirmation, which shows them there.
  async function handleMove() {
    handleChanged(await moveUmpire(umpire.id, moveFacilityId))
    setMoveFacilityId('')
  }

  if (loading) return <section className="sheet"><p className="empty">Loading…</p></section>

  if (result.notFound) {
    return (
      <section className="sheet">
        <p className="empty missing">There’s no umpire here.</p>
        <p><Link to="/umpires" className="back-link">← Umpires</Link></p>
      </section>
    )
  }

  if (result.error) {
    return (
      <section className="sheet">
        <p className="form-error" role="alert">{result.error}</p>
        <p><Link to="/umpires" className="back-link">← Umpires</Link></p>
      </section>
    )
  }

  return (
    <section>
      <PageBoard
        title={umpire.name}
        intro={
          <>
            <StatusTag status={umpire.status} />
            {umpire.facilityId && <> · <Link to={`/facilities/${umpire.facilityId}`}>{umpire.facilityName}</Link></>}
          </>
        }
      >
        <div className="tally">
          <TallyCell figure={umpire.matchCount} label="Matches scored" />
          <TallyCell figure={umpire.matchesInProgress} label="Live now" />
        </div>
      </PageBoard>

      <div className="sheet">
        <Link to="/umpires" className="back-link">← Umpires</Link>

        {umpire.status === 'paused' && (
          <p className="notice">Paused on {formatWhen(umpire.pausedAt)}: {umpire.pausedReason}</p>
        )}
        {umpire.status === 'closed' && (
          <p className="notice">Closed on {formatWhen(umpire.closedAt)}</p>
        )}

        <div>
          <h2 className="section-title"><Icon name="list" />Details</h2>
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
          <h2 className="section-title"><Icon name="calendar" />Recent matches scored</h2>
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

        <AccountActions
          kind="umpires"
          person={umpire}
          me={me}
          onChanged={handleChanged}
          extraActions={(confirming, setConfirming) => (
            me.role === 'owner' && (
              <RowConfirm
                label="Move"
                className="btn-quiet btn-small"
                question={<FacilityPicker me={me} value={moveFacilityId} onChange={setMoveFacilityId} label="Move to" />}
                confirmLabel="Move"
                busyLabel="Moving…"
                confirmClass="btn-primary btn-small"
                keepLabel="Not now"
                open={confirming === 'move'}
                disabled={confirming === 'move' && !moveFacilityId}
                onOpen={() => { setMoveFacilityId(''); setConfirming('move') }}
                onClose={() => setConfirming(null)}
                onConfirm={handleMove}
              />
            )
          )}
        />
      </div>
    </section>
  )
}
