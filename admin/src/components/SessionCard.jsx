import { agoText, clockText } from '../lib/format'

/** One open session, right now: who opened it, its players, and its live courts. */
export default function SessionCard({ session, showFacility, now }) {
  return (
    <article className="session-card">
      <div className="session-top">
        <span className="session-name">{session.name}</span>
        {showFacility && <span className="fac-chip">{session.facilityName}</span>}
        <span className="session-meta">Opened by <b>{session.openedBy ?? 'an umpire'}</b> at {clockText(session.openedAt)}</span>
        <span className="session-players"><b>{session.playerCount}</b> {session.playerCount === 1 ? 'player' : 'players'} · <b>{session.onCourt}</b> on court</span>
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
              {match.teamA.map((player) => <span key={player.id}>{player.name}</span>)}
            </div>
            <div className="score board-texture"><b>{match.score.A}</b><b>{match.score.B}</b></div>
            <div className={`team b${match.servingTeam === 'B' ? ' serving' : ''}`}>
              {match.teamB.map((player) => <span key={player.id}>{player.name}</span>)}
            </div>
            <div className="court-side">
              <span className="who">Scored by {match.umpireName}</span>
              <span>Started {agoText(match.startedAt, now)}</span>
              <span className="to">Game to {match.pointTarget}</span>
            </div>
          </div>
        ))}
    </article>
  )
}
