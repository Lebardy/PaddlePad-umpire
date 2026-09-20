import { formatWhen } from '../lib/format'

/** "<b>+9</b> new this week", or the plain "none this week" once there's nothing to boast about. */
function newLine(n, word) {
  if (n === 0) return 'none this week'
  return <><b>+{n}</b> {word}</>
}

/** The right column: players, matches, sessions, umpires, and when ratings last ran. */
export default function Totals({ totals, facilityName }) {
  return (
    <>
      <div className="totals">
        <div className="total">
          <span className="total-label">Players</span>
          <span className="total-figure">{totals.players.count.toLocaleString()}</span>
          <span className="total-new">{newLine(totals.players.newThisWeek, 'new this week')}</span>
        </div>
        <div className="total">
          <span className="total-label">Matches</span>
          <span className="total-figure">{totals.matches.count.toLocaleString()}</span>
          <span className="total-new">{newLine(totals.matches.newThisWeek, 'this week')}</span>
        </div>
        <div className="total">
          <span className="total-label">Sessions</span>
          <span className="total-figure">{totals.sessions.count.toLocaleString()}</span>
          <span className="total-new">{newLine(totals.sessions.newThisWeek, 'this week')}</span>
        </div>
        <div className="total">
          <span className="total-label">Umpires active now</span>
          <span className="total-figure">{totals.umpires.active.toLocaleString()}</span>
          <span className="total-new">{totals.umpires.notActive} not active</span>
        </div>
        <div className="total-rating">
          <span className="total-label">Ratings last worked out</span>
          <strong>{totals.ratings ? formatWhen(totals.ratings.computedAt) : 'Not yet'}</strong>
          <span className="sub">{totals.ratings ? `${totals.ratings.playerCount} players rated` : 'No ratings run yet'}</span>
        </div>
      </div>
      {facilityName && (
        <p className="hint" style={{ marginTop: '0.6rem' }}>
          Players counts everyone who has played at {facilityName}. Players themselves belong to no facility.
        </p>
      )}
    </>
  )
}
