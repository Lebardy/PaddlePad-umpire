function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * A player's matches, newest first.
 *
 * Written from their point of view throughout: their score first, their
 * partner and opponents by name, and won/lost from their side. The
 * server sends it that way already, so nothing here has to know which
 * team they were on.
 */
function MatchList({ matches }) {
  return (
    <section className="match-list">
      <h2>Your matches</h2>
      <ul>
        {matches.map((match) => (
          <li key={match.id} className={match.won ? 'won' : 'lost'}>
            <div className="match-top">
              <span className={`result ${match.won ? 'won' : 'lost'}`}>
                {match.won === null ? 'No result' : match.won ? 'Won' : 'Lost'}
              </span>
              <span className="score">
                {match.yourScore}–{match.theirScore}
              </span>
            </div>

            <p className="lineup">
              {match.partner && (
                <>
                  with <strong>{match.partner}</strong>{' '}
                </>
              )}
              against <strong>{match.opponents.join(' & ')}</strong>
            </p>

            <p className="match-meta">
              {formatDate(match.endedAt)} · {match.sessionName}
              {match.endedEarly && ' · ended early'}
            </p>

            <div className="match-stats">
              <span>
                {match.stats.clean_winners + match.stats.dink_winners} winners
              </span>
              <span>
                {match.stats.unforced_errors + match.stats.dink_errors} errors
              </span>
              {match.stats.drop_attempts > 0 && (
                <span>
                  {match.stats.drop_successes}/{match.stats.drop_attempts} drops
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default MatchList
