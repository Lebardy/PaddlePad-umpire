import { agoText, countWord, formatWhen } from '../lib/format'

const AMBER_REASONS = new Set(['ended_early', 'short', 'long'])

/** One left-open session, sitting above the flagged matches: nobody has ended it, but nobody can from here. */
function LeftOpenRow({ session, isOwner }) {
  return (
    <tr>
      <td>
        <span className="cell-main"><strong>{session.name}</strong></span>
        <span className="cell-sub">{countWord(session.playerCount, 'player', 'players')} · still open</span>
      </td>
      <td><div className="reasons"><span className="reason amber">{session.tag}</span></div></td>
      <td>{session.openedBy}</td>
      {isOwner && <td>{session.facilityName}</td>}
      <td className="col-when">{formatWhen(session.openedAt)}</td>
      <td className="col-actions"><div className="row-actions"><span className="row-note">Only the umpire can end a session</span></div></td>
    </tr>
  )
}

/** One flagged match: what's odd about it, and (once Task 7 wires it up) the buttons to clear it. */
function WarningRow({ warning, isOwner, now, actions }) {
  return (
    <tr className={warning.voided ? 'is-voided' : undefined}>
      <td>
        <span className="cell-main"><strong>{warning.teamA.join(' & ')}</strong> vs {warning.teamB.join(' & ')}</span>
        <span className="cell-sub">
          {warning.sessionName} · {warning.status === 'in_progress' ? 'still in progress' : `finished ${warning.score.A}–${warning.score.B}`}
        </span>
      </td>
      <td>
        <div className="reasons">
          {warning.reasons.map((r) => (
            <span key={r.reason} className={`reason${AMBER_REASONS.has(r.reason) ? ' amber' : ''}`}>{r.tag}</span>
          ))}
        </div>
      </td>
      <td>{warning.umpireName}</td>
      {isOwner && <td>{warning.facilityName}</td>}
      <td className="col-when">{formatWhen(warning.startedAt)}</td>
      <td className="col-actions">
        <div className="row-actions">
          {warning.voided
            ? <span className="fine-done">Voided by {warning.voided.byMe ? 'you' : warning.voided.byName} · {agoText(warning.voided.at, now)}</span>
            : actions /* buttons land in Task 7 */}
        </div>
      </td>
    </tr>
  )
}

/** The facility's odd matches and left-open sessions, in one table, newest concern last. */
export default function WorthALook({ warnings, leftOpen, isOwner, now, actions }) {
  const activeCount = leftOpen.length + warnings.filter((w) => !w.voided).length
  const isEmpty = leftOpen.length === 0 && warnings.length === 0
  return (
    <div>
      <div className="section-head">
        <h2 className="section-title">Worth a look{activeCount > 0 && <span className="worth-count">{activeCount}</span>}</h2>
        <span className="section-count">Last 30 days · Void takes a match out of stats and ratings; it can be undone</span>
      </div>

      {isEmpty ? (
        <div className="all-clear">
          <strong>Nothing worth a look</strong>
          <span>No odd matches in the last 30 days, and no sessions left open.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Match</th>
                <th>What’s odd</th>
                <th>Umpire</th>
                {isOwner && <th>Facility</th>}
                <th className="col-when">When</th>
                <th className="col-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {leftOpen.map((session) => <LeftOpenRow key={session.sessionId} session={session} isOwner={isOwner} />)}
              {warnings.map((warning) => (
                <WarningRow key={warning.matchId} warning={warning} isOwner={isOwner} now={now} actions={actions} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
