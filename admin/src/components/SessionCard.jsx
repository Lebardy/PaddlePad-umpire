import Icon from './Icon'
import { agoText, clockText } from '../lib/format'

/** One open session, right now: who opened it, its players, and its live courts. */
export default function SessionCard({ session, showFacility, now }) {
  return (
    <article className="session-card">
      <div className="session-top">
        <span className="session-name">{session.name}</span>
        {showFacility && <span className="fac-chip">{session.facilityName}</span>}
        <span className="session-meta"><Icon name="clipboard" size={15} /> <b>{session.openedBy ?? 'an umpire'}</b> <Icon name="clock" size={15} /> {clockText(session.openedAt)}</span>
        <span className="session-players" title="Players"><Icon name="people" size={15} /> <b>{session.playerCount}</b><span className="sr-only"> players</span></span>
      </div>
      {session.matches.length === 0
        ? (
          <div className="court-idle">
            {session.lastMatchEndedAt
              ? `No match on court right now — last one ended ${agoText(session.lastMatchEndedAt, now)}.`
              : 'No match yet.'}
          </div>
        )
        : session.matches.map((match) => (
          <div className="court" key={match.id}>
            <div className={`team${match.servingTeam === 'A' ? ' serving' : ''}`}>
              {match.servingTeam === 'A' && <span className="sr-only">serving</span>}
              {match.teamA.map((player) => <span key={player.id}>{player.name}</span>)}
            </div>
            <div className="score board-texture"><b>{match.score.A}</b><b>{match.score.B}</b></div>
            <div className={`team b${match.servingTeam === 'B' ? ' serving' : ''}`}>
              {match.servingTeam === 'B' && <span className="sr-only">serving</span>}
              {match.teamB.map((player) => <span key={player.id}>{player.name}</span>)}
            </div>
            <div className="court-side">
              {match.umpireName !== session.openedBy && <span className="who"><Icon name="clipboard" size={14} /> {match.umpireName}</span>}
              <span><Icon name="clock" size={14} /> {agoText(match.startedAt, now)}</span>
            </div>
          </div>
        ))}
    </article>
  )
}
