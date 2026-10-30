import { useState } from 'react'
import Icon from './Icon'
import VideoMark from './VideoMark'
import { Link } from '../lib/router'
import { agoText, countWord, formatWhen } from '../lib/format'
import DuplicatePlayers from './DuplicatePlayers'
import { filterWorth, umpireChoices, worthChips } from '../lib/worthFilters'

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
        <span className="cell-main">
          <Link to={`/matches/${warning.matchId}`} className="row-link match-link">
            <strong>{warning.teamA.join(' & ')}</strong> vs {warning.teamB.join(' & ')}{warning.hasVideo && <VideoMark />}
          </Link>
        </span>
        <span className="cell-sub">
          {warning.sessionName}
          {warning.status === 'in_progress'
            ? ' · still in progress'
            : !warning.reasons.some((r) => r.reason === 'shutout') && <> · <span className="nowrap">finished {warning.score.A}–{warning.score.B}</span></>}
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
              <button type="button" className="btn-quiet btn-small btn-icon" disabled={busy} onClick={handleLooksFine} title="Looks fine" aria-label="Looks fine"><Icon name="check" size={16} /></button>
              <button type="button" className="btn-danger btn-small btn-icon" disabled={busy} onClick={() => actions.openVoid(warning)} title="Void" aria-label="Void"><Icon name="ban" size={16} /></button>
            </>
          )}
          {error && <span className="row-error" role="alert">{error}</span>}
        </div>
      </td>
    </tr>
  )
}

/** What a chip says once everything under it is cleared, and its note. */
const CHIP_TEXT = {
  stuck: { empty: ['Nothing stuck', 'No match in this window was left running.'] },
  ended_early: { empty: ['Nothing ended early', 'Every match in this window was played to the end.'] },
  shutout: { empty: ['No shutouts', 'No match in this window ended with a side on 0.'] },
  length: { empty: ['Nothing too short or long', 'Every match in this window took a normal length of time.'] },
  left_open: { note: 'Sessions nobody ended · Close tidies them up; the umpire can reopen', empty: ['No sessions left open', 'Every session has been ended.'] },
  duplicates: { note: 'Only you see this · across every facility', empty: ['No likely duplicate players', 'Every player name looks like a different person.'] },
}

const SHOWN = 8

export function AllClear({ title, text }) {
  return (
    <div className="all-clear">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

export function MatchTable({ warnings, showFacility, now, actions }) {
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

export function LeftOpenTable({ sessions, showFacility, actions }) {
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
 * Everything worth a look, narrowed by chips and two filters: odd matches,
 * sessions left open, and -- for the owner, when `duplicates` is given --
 * players who might be the same person entered twice.
 */
export default function WorthALook({ warnings, leftOpen, duplicates, showFacility, now, actions, duplicateActions }) {
  const [chip, setChip] = useState('all')
  const [umpire, setUmpire] = useState('')
  const [days, setDays] = useState(30)
  const [showAll, setShowAll] = useState(false)
  const data = { warnings, leftOpen, duplicates }

  function pick(set, value) { set(value); setShowAll(false) }

  // A refresh can drop the picked umpire; then show everyone rather than a hidden filter.
  const who = umpireChoices(data).includes(umpire) ? umpire : ''
  const found = filterWorth(data, { chip, umpire: who, days })
  const total = found.warnings.length + found.leftOpen.length + found.duplicates.length
  const room = showAll ? total : SHOWN
  const shownWarnings = found.warnings.slice(0, room)
  const shownLeftOpen = found.leftOpen.slice(0, room - shownWarnings.length)
  const shownDuplicates = found.duplicates.slice(0, room - shownWarnings.length - shownLeftOpen.length)
  const shown = shownWarnings.length + shownLeftOpen.length + shownDuplicates.length
  const text = CHIP_TEXT[chip]

  return (
    <div>
      <div className="worth-bar">
      <div className="worth-chips" role="group" aria-label="Why it’s worth a look">
        {worthChips(data).map((c) => (
          <button key={c.id} type="button" className="worth-chip" aria-pressed={chip === c.id} onClick={() => pick(setChip, c.id)}>
            {c.label}<span className={`tab-count${c.count === 0 ? ' is-zero' : ''}`}>{c.count}</span>
          </button>
        ))}
      </div>
      <div className="worth-filters">
        <label>
          <Icon name="clipboard" size={16} />
          <select aria-label="Umpire" value={who} onChange={(e) => pick(setUmpire, e.target.value)}>
            <option value="">Any</option>
            {umpireChoices(data).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <Icon name="calendar" size={16} />
          <select aria-label="When" value={days} onChange={(e) => pick(setDays, Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
      </div>
      </div>

      {total === 0 ? (
        <AllClear
          title={text ? text.empty[0] : 'Nothing worth a look'}
          text={text ? text.empty[1] : duplicates
            ? 'No odd matches in this window, no sessions left open, and no likely duplicate players.'
            : 'No odd matches in this window, and no sessions left open.'}
        />
      ) : (
        <>
          {shownWarnings.length > 0 && <MatchTable warnings={shownWarnings} showFacility={showFacility} now={now} actions={actions} />}
          {shownLeftOpen.length > 0 && <LeftOpenTable sessions={shownLeftOpen} showFacility={showFacility} actions={actions} />}
          {shownDuplicates.length > 0 && <DuplicatePlayers pairs={shownDuplicates} actions={duplicateActions} />}
          <div className="table-foot">
            <span>Showing {shown} of {total}{text?.note && ` · ${text.note}`}</span>
            {shown < total && <button type="button" className="btn-quiet btn-small" onClick={() => setShowAll(true)}>Show {total - shown} more</button>}
          </div>
        </>
      )}
    </div>
  )
}
