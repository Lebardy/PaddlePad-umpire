import { useState } from 'react'
import Icon from '../components/Icon'
import { deriveMatchState, currentServerPlayerId } from '../lib/pickleball'
import { isGamePoint, timeoutsLeft } from '../lib/scoreHelpers'
import { askConclude, queueRuling } from '../lib/storage'
import { flush } from '../lib/sync'
import { useQueuedRulings } from '../lib/useLocalStore'
import { newestRuling, rallyWinnerTeam, rulingProblem, waitingReentry } from '../../server/src/scorekeeper-rules.js'
import { legacyRallyLabel, rallyEnding } from '../lib/outcomes'

const KIND_WORDS = { stands: 'Stands', overturned: 'Overturned', replay: 'Replay', wrongWinner: 'Wrong winner', wrongCall: 'Wrong call' }
const STATE_WORDS = { queued: 'Waiting to send', waiting: 'Sent, not applied yet', applied: 'Applied' }
const SEEN_LATE_MS = 20_000
const RALLIES_SHOWN = 12

/**
 * The match umpire's screen while someone else taps: the score, the last
 * rally large, and the two things only they decide about it.
 */
function MatchOverview({ match, name, onTakeBack }) {
  const [choosing, setChoosing] = useState(false)
  const queued = useQueuedRulings()
  const derived = deriveMatchState(match)
  const serverId = currentServerPlayerId(derived, match)
  const last = match.events.at(-1)
  const lastRally = last?.type === 'rally' ? last : null
  const reenter = waitingReentry(match.events, match.teamA)
  // The card shows the last rally, or after a ruling the rally it ruled on (a replaced one lives on in `was`).
  const appliedNote = last?.type === 'ruling' ? last : null
  const subject = lastRally ?? (appliedNote && (appliedNote.was ?? match.events.at(-2)))
  // Earlier rallies with the score after each, newest first.
  const rallies = match.events
    .flatMap((e, i) => (e.type === 'rally' && e.id !== subject?.id ? [{ e, score: deriveMatchState({ ...match, events: match.events.slice(0, i + 1) }).score }] : []))
    .slice(-RALLIES_SHOWN)
    .reverse()
  const gamePoint = !derived.completed && isGamePoint(derived)
  const most = derived.pointTarget === 21 ? 3 : 2
  const teamWords = (team) => (team === 'A' ? match.teamA : match.teamB).map(name).join(' / ')

  // The newest word on the last rally: this phone's unsent one first, then the server's.
  const mine = lastRally && queued.find((r) => r.matchId === match.id && r.targetEventId === lastRally.id)
  const theirs = lastRally && (match.rulings ?? []).find((r) => r.targetEventId === lastRally.id)
  const ruling = mine ? { kind: mine.kind, state: 'queued' } : theirs
  // The newest ruling may be on a rally the card has moved past; its outcome still shows.
  const mineAll = queued.filter((r) => r.matchId === match.id)
  const newest = newestRuling(mineAll, match.rulings ?? [])
  const stray = newest && newest.targetEventId !== subject?.id && (newest.state === 'queued' || newest.state === 'refused') ? newest : null
  const seenAgo = match.scorekeeper?.seenAt ? Date.now() - new Date(match.scorekeeper.seenAt).getTime() : null
  const canRule = lastRally && !ruling && mineAll.length === 0 && rulingProblem(match.events, lastRally.id) === null && !match.concludeAsk
  const won = derived.completed
  // An ace or a service or foot fault is the server's alone: the side is not in doubt, only the call (Wrong call).
  const serverOnly = rallyEnding(lastRally?.detail)?.by === 'server'
  // Never over a ruling still on its way: that ruling may remove the winning rally.
  const canConclude = won && !match.voidedAt && mineAll.length === 0 && !match.concludeAsk && ruling?.state !== 'waiting'

  function rule(kind) {
    queueRuling(match.id, lastRally.id, kind)
    flush()
    setChoosing(false)
  }

  function conclude() {
    askConclude(match.id, last.id)
    flush()
  }

  return (
    <div className="match-overview">
      <div className="overview-main">
      <div className="scoreboard overview-board" aria-label="Score" aria-live="polite">
        {['A', 'B'].map((key) => {
          const serving = !won && derived.servingTeam === key
          const left = timeoutsLeft(match.events, key, derived.pointTarget)
          return (
            <div key={key} className={`score-side has-timeout${serving ? ' serving' : ''}${serving && gamePoint ? ' is-game-point' : ''}`}>
              <span className="score-names">
                {(key === 'A' ? match.teamA : match.teamB).map((id) => (
                  <span key={id} className={id === serverId && !won ? 'is-server' : undefined}>{name(id)}</span>
                ))}
              </span>
              <span className="overview-timeouts" aria-label={`${left} ${left === 1 ? 'timeout' : 'timeouts'} left`}>
                <Icon name="timer" size={18} />
                <span className="timeout-pips" aria-hidden="true">
                  {Array.from({ length: most }, (_, i) => <span key={i} className={i < left ? 'is-left' : undefined} />)}
                </span>
              </span>
              <span className="score-value">{derived.score[key]}</span>
              {serving && <span className="serving-tag">{gamePoint ? 'Game point' : 'Serving'}</span>}
            </div>
          )
        })}
      </div>
      <p className="overview-scorer">
        <Icon name="user" size={18} />{match.scorekeeper?.name} scoring
        {seenAgo !== null && seenAgo > SEEN_LATE_MS && <span className="seen-late"> · seen {Math.round(seenAgo / 1000)} s ago</span>}
      </p>

      {stray && (
        <p className={`ruling-state overview-stray is-${stray.state}`} role="status">
          <Icon name={stray.state === 'queued' ? 'timer' : 'alert'} size={16} />
          {KIND_WORDS[stray.kind]} · {stray.state === 'refused' ? stray.refused : STATE_WORDS.queued}
        </p>
      )}

      {reenter && <p className="overview-wait"><Icon name="timer" size={18} />Waiting: rally to {teamWords(reenter)}</p>}

      {subject && (
        <section className={`last-rally${appliedNote?.was ? ' is-removed' : ''}`} aria-label="Last rally">
          <strong>{teamWords(rallyWinnerTeam(match.teamA, subject))} won the {won ? 'match' : 'rally'}</strong>
          <span>{rallyEnding(subject.detail)?.label ?? legacyRallyLabel(subject.outcome, subject.zone)} — {name(subject.actingPlayerId)}</span>
          {appliedNote && (
            <span className="ruling-state is-applied" role="status">
              <Icon name="check" size={16} />{KIND_WORDS[appliedNote.kind]} · Applied
            </span>
          )}
          {ruling && (
            <span className={`ruling-state is-${ruling.state}`} role="status">
              {KIND_WORDS[ruling.kind]} · {ruling.state === 'refused' ? ruling.refused : STATE_WORDS[ruling.state]}
            </span>
          )}
          {match.concludeAsk && (
            <span className="ruling-state is-queued" role="status"><Icon name="timer" size={16} />Conclude · Waiting to send</span>
          )}
          {(canRule || canConclude) && !choosing && (
            <div className="overview-actions">
              {canConclude && <button onClick={conclude}><Icon name="check" size={18} />Conclude match</button>}
              {canRule && <button className={won ? 'btn-quiet' : undefined} onClick={() => setChoosing(true)}><Icon name="flag" size={18} />Appeal</button>}
              {canRule && !serverOnly && <button className="btn-quiet" onClick={() => rule('wrongWinner')}><Icon name="retry" size={18} />Wrong winner</button>}
              {canRule && <button className="btn-quiet" onClick={() => rule('wrongCall')}><Icon name="undo" size={18} />Wrong call</button>}
            </div>
          )}
          {choosing && (
            <div className="overview-actions" role="group" aria-label="Appeal ruling">
              <button onClick={() => (!won || confirm("Stands? The win can't be appealed after this.")) && rule('stands')}><Icon name="check" size={18} />Stands</button>
              <button onClick={() => rule('overturned')}><Icon name="retry" size={18} />Overturned</button>
              <button onClick={() => rule('replay')}><Icon name="undo" size={18} />Replay</button>
              <button className="icon-solo" onClick={() => setChoosing(false)} aria-label="Not now"><Icon name="x" size={18} /></button>
            </div>
          )}
        </section>
      )}

      </div>

      <aside className="overview-side" aria-label="Earlier rallies">
        <h3>Earlier rallies</h3>
        {rallies.length === 0 ? <p className="overview-none">None yet</p> : (
          <ol className="overview-rallies">
            {rallies.map(({ e: r, score }) => (
              <li key={r.id} className={`is-${rallyWinnerTeam(match.teamA, r)}`}>
                <span className="overview-rally-score">{score.A}–{score.B}</span>
                <span>{rallyEnding(r.detail)?.label ?? legacyRallyLabel(r.outcome, r.zone)} · {name(r.actingPlayerId)}</span>
              </li>
            ))}
          </ol>
        )}
        <button className="btn-quiet take-back" onClick={() => confirm('Take scoring back?') && onTakeBack()}>
          <Icon name="undo" size={18} />Take scoring back
        </button>
      </aside>
    </div>
  )
}

export default MatchOverview
