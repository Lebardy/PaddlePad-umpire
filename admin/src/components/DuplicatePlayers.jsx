import { Link } from '../lib/router'
import { countWord, formatWhen } from '../lib/format'

/** One player's half of the "who's who" line: their match count, and since when if it's known. */
function playerLine(player) {
  const since = player.firstMatchAt ? ` since ${formatWhen(player.firstMatchAt)}` : ''
  return `${player.name}: ${countWord(player.matchCount, 'match', 'matches')}${since}`
}

/** Owner-only: pairs of players who might be the same person entered twice. */
export default function DuplicatePlayers({ pairs, actions }) {
  return (
    <div>
      <div className="section-head">
        <h2 className="section-title">Possible duplicate players{pairs.length > 0 && <span className="worth-count">{pairs.length}</span>}</h2>
        <span className="section-count">Only you see this · across every facility</span>
      </div>

      {pairs.length === 0 ? (
        <div className="all-clear">
          <strong>No likely duplicates</strong>
          <span>Every player name looks like a different person.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Players</th>
                <th>Why they were flagged</th>
                <th className="col-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => {
                const key = `${pair.a.id}:${pair.b.id}`
                const bothSignedIn = pair.a.hasSignIn && pair.b.hasSignIn
                const busy = actions.busyKey === key
                const error = actions.errors[key]
                return (
                  <tr key={key}>
                    <td>
                      <div className="pair-names">
                        <Link to={`/players/${pair.a.id}`}>{pair.a.name}</Link>
                        <span className="vs">and</span>
                        <Link to={`/players/${pair.b.id}`}>{pair.b.name}</Link>
                      </div>
                      <span className="cell-sub">{playerLine(pair.a)} · {playerLine(pair.b)}</span>
                    </td>
                    <td>{pair.text}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button type="button" className="btn-quiet btn-small" disabled={busy} onClick={() => actions.notSame(pair)}>
                          Not the same person
                        </button>
                        <button
                          type="button"
                          className="btn-primary btn-small"
                          disabled={bothSignedIn || busy}
                          onClick={() => actions.openMerge(pair)}
                        >
                          Merge
                        </button>
                        {bothSignedIn && <span className="row-note">Can’t merge: both have signed in to the player app</span>}
                        {error && <span className="row-error" role="alert">{error}</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
