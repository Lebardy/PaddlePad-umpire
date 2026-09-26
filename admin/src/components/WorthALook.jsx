import { useState } from 'react'
import { agoText, countWord, formatWhen } from '../lib/format'
import DuplicatePlayers from './DuplicatePlayers'
import PanelTabs from './PanelTabs'

const AMBER_REASONS = new Set(['ended_early', 'short', 'long'])

/**
 * One left-open session: nobody has ended it, but an admin can close it. Close is the only action this row
 * has, and its own dialog owns its busy/error state (the same shape as
 * Void's), so there's no shared busy id or row error to check here.
 */
function LeftOpenRow({ session, showFacility, actions }) {
  return (
    <tr>
      <td>
        <span className="cell-main"><strong>{session.name}</strong></span>
        <span className="cell-sub">{countWord(session.playerCount, 'player', 'players')} · still open</span>
      </td>
      <td><div className="reasons"><span className="reason amber">{session.tag}</span></div></td>
      <td>{session.openedBy}</td>
      {showFacility && <td>{session.facilityName}</td>}
      <td className="col-when">{formatWhen(session.openedAt)}</td>
      <td className="col-actions">
        <div className="row-actions">
          <button type="button" className="btn-danger btn-small" onClick={() => actions.openClose(session)}>Close</button>
        </div>
      </td>
    </tr>
  )
}

/** One flagged match: what's odd about it, and the buttons to clear it. */
function WarningRow({ warning, showFacility, now, actions }) {
  const busy = actions.busyId === warning.matchId
  const error = actions.errors[warning.matchId]

  async function handleLooksFine() {
    for (const reason of warning.reasons) {
      await actions.looksFine(warning.matchId, reason.reason)
    }
  }

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
      {showFacility && <td>{warning.facilityName}</td>}
      <td className="col-when">{formatWhen(warning.startedAt)}</td>
      <td className="col-actions">
        <div className="row-actions">
          {warning.voided ? (
            <>
              <span className="fine-done">Voided by {warning.voided.byMe ? 'you' : warning.voided.byName} · {agoText(warning.voided.at, now)}</span>
              <button type="button" className="btn-quiet btn-small" disabled={busy} onClick={() => actions.undo(warning.matchId)}>Undo</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-quiet btn-small" disabled={busy} onClick={handleLooksFine}>Looks fine</button>
              <button type="button" className="btn-danger btn-small" disabled={busy} onClick={() => actions.openVoid(warning)}>Void</button>
            </>
          )}
          {error && <span className="row-error" role="alert">{error}</span>}
        </div>
      </td>
    </tr>
  )
}

const MATCH_NOTE = 'Last 30 days · Void takes a match out of stats and ratings; it can be undone'

/**
 * The tabs, by reason. A match with two reasons shows under both. The
 * empty text is what a tab says once everything under it is cleared.
 */
const TABS = [
  { id: 'stuck', label: 'Stuck', reasons: ['stuck'],
    empty: ['Nothing stuck', 'No match in the last 30 days was left running.'] },
  { id: 'ended_early', label: 'Ended early', reasons: ['ended_early'],
    empty: ['Nothing ended early', 'Every match in the last 30 days was played to the end.'] },
  { id: 'shutout', label: 'Shutouts', reasons: ['shutout'],
    empty: ['No shutouts', 'No match in the last 30 days ended with a side on 0.'] },
  { id: 'length', label: 'Too short / long', reasons: ['short', 'long'],
    empty: ['Nothing too short or long', 'Every match in the last 30 days took a normal length of time.'] },
  { id: 'left_open', label: 'Left open', note: 'Sessions nobody ended · Close tidies them up; the umpire can reopen',
    empty: ['No sessions left open', 'Every session has been ended.'] },
  { id: 'duplicates', label: 'Duplicates', note: 'Only you see this · across every facility',
    empty: ['No likely duplicates', 'Every player name looks like a different person.'] },
]

function AllClear({ title, text }) {
  return (
    <div className="all-clear">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function MatchTable({ warnings, showFacility, now, actions }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Match</th>
            <th>What’s odd</th>
            <th>Umpire</th>
            {showFacility && <th>Facility</th>}
            <th className="col-when">When</th>
            <th className="col-actions"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {warnings.map((warning) => (
            <WarningRow key={warning.matchId} warning={warning} showFacility={showFacility} now={now} actions={actions} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LeftOpenTable({ sessions, showFacility, actions }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Session</th>
            <th>What’s odd</th>
            <th>Opened by</th>
            {showFacility && <th>Facility</th>}
            <th className="col-when">Opened</th>
            <th className="col-actions"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => <LeftOpenRow key={session.sessionId} session={session} showFacility={showFacility} actions={actions} />)}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Everything worth a look, in tabs by reason: odd matches, sessions left
 * open, and -- for the owner, when `duplicates` is given -- players who
 * might be the same person entered twice.
 */
export default function WorthALook({ warnings, leftOpen, duplicates, showFacility, now, actions, duplicateActions }) {
  const [picked, setPicked] = useState(null)

  const tabs = TABS.filter((tab) => tab.id !== 'duplicates' || duplicates).map((tab) => {
    let rows
    let count
    if (tab.reasons) {
      rows = warnings.filter((w) => w.reasons.some((r) => tab.reasons.includes(r.reason)))
      // A voided match stays on its tab for Undo, but it's been dealt with.
      count = rows.filter((w) => !w.voided).length
    } else {
      rows = tab.id === 'left_open' ? leftOpen : duplicates
      count = rows.length
    }
    return { ...tab, rows, count }
  })

  const activeCount = leftOpen.length + warnings.filter((w) => !w.voided).length + (duplicates?.length ?? 0)
  const isEmpty = tabs.every((tab) => tab.rows.length === 0)

  // Open on the first tab with something to do (or, failing that, anything
  // on it at all), then stay put: the 30-second refresh and clearing the
  // last row on a tab never move the admin somewhere else.
  const firstBusy = (tabs.find((tab) => tab.count > 0) ?? tabs.find((tab) => tab.rows.length > 0) ?? tabs[0]).id
  if (picked === null && !isEmpty) setPicked(firstBusy)
  const current = tabs.find((tab) => tab.id === picked) ?? tabs.find((tab) => tab.id === firstBusy)

  return (
    <div>
      <div className="section-head">
        <h2 className="section-title">Worth a look{activeCount > 0 && <span className="worth-count">{activeCount}</span>}</h2>
        {!isEmpty && <span className="section-count">{current.note ?? MATCH_NOTE}</span>}
      </div>

      {isEmpty ? (
        <AllClear
          title="Nothing worth a look"
          text={duplicates
            ? 'No odd matches in the last 30 days, no sessions left open, and no likely duplicate players.'
            : 'No odd matches in the last 30 days, and no sessions left open.'}
        />
      ) : (
        <>
          <PanelTabs label="Why it’s worth a look" tabs={tabs} current={current.id} onChange={setPicked} />
          {current.rows.length === 0 && <AllClear title={current.empty[0]} text={current.empty[1]} />}
          {current.rows.length > 0 && current.reasons && (
            <MatchTable warnings={current.rows} showFacility={showFacility} now={now} actions={actions} />
          )}
          {current.rows.length > 0 && current.id === 'left_open' && (
            <LeftOpenTable sessions={current.rows} showFacility={showFacility} actions={actions} />
          )}
          {current.rows.length > 0 && current.id === 'duplicates' && (
            <DuplicatePlayers pairs={current.rows} actions={duplicateActions} />
          )}
        </>
      )}
    </div>
  )
}
