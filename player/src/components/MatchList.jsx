import Sparkline from './Sparkline'
import { Link } from '../lib/router'
import { matchStory } from '../lib/story'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * A player's matches, newest first, written entirely from their side --
 * their score first, won or lost from their point of view, and everyone
 * else by name. The server sends it that way, so nothing here needs to
 * work out which team they were on.
 */
function MatchList({ matches }) {
  return (
    <section className="match-list" aria-label="Match history">
      <h2>Every match</h2>
      <ol>
        {matches.map((match) => {
          const winners = match.stats.clean_winners + match.stats.dink_winners
          const errors = match.stats.unforced_errors + match.stats.dink_errors
          const result =
            match.won === null ? 'none' : match.won ? 'won' : 'lost'
          const story = matchStory(match.progression, match.won, match.pointTarget)

          return (
            <li key={match.id} className={`match ${result}`}>
              {/* The whole row is the target. A row that shows a match
                  but cannot open it is the thing that made this app feel
                  like a page rather than an app. */}
              <Link className="match-link" to={`/matches/${match.id}`}>
              <div className="match-score">
                <span className="ms-yours">{match.yourScore}</span>
                <span className="ms-dash">–</span>
                <span className="ms-theirs">{match.theirScore}</span>
              </div>

              <div className="match-body">
                <p className="match-versus">
                  {match.opponents.join(' & ')}
                </p>
                {match.partner && (
                  <p className="match-partner">with {match.partner}</p>
                )}
                <p className="match-meta">
                  {formatDate(match.endedAt)} · {match.sessionName}
                  {/* Only when it wasn't the usual 11, so a 15-13 score
                      doesn't read as a game that ran unusually long. */}
                  {match.pointTarget && match.pointTarget !== 11
                    ? ` · to ${match.pointTarget}`
                    : ''}
                  {match.endedEarly && ' · stopped early'}
                </p>

                {/* The shape of the game, and the one thing worth
                    saying about it. Both come from the same score
                    margins, so neither costs an extra request. */}
                <Sparkline margins={match.progression} won={match.won} />
                {story && <p className="match-story">{story}</p>}

                <div className="match-chips">
                  {/* Spelled out rather than "3W / 2E": on a row that
                      already says won or lost, a bare W reads as a win. */}
                  <span className="chip">{winners} winning shots</span>
                  <span className="chip">{errors} mistakes</span>
                  {match.stats.drop_attempts > 0 && (
                    <span className="chip">
                      {match.stats.drop_successes}/{match.stats.drop_attempts} drops
                    </span>
                  )}
                  <span className="chip chip-quiet">#{match.matchNumber}</span>
                </div>
              </div>
              <span className="match-chevron" aria-hidden="true">&rsaquo;</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default MatchList
