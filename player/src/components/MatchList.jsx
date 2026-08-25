import Sparkline from './Sparkline'
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
          const story = matchStory(match.progression, match.won)

          return (
            <li key={match.id} className={`match ${result}`}>
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
                  {match.endedEarly && ' · stopped early'}
                </p>

                {/* The shape of the game, and the one thing worth
                    saying about it. Both come from the same score
                    margins, so neither costs an extra request. */}
                <Sparkline margins={match.progression} won={match.won} />
                {story && <p className="match-story">{story}</p>}

                <div className="match-chips">
                  <span className="chip">{winners}W</span>
                  <span className="chip">{errors}E</span>
                  {match.stats.drop_attempts > 0 && (
                    <span className="chip">
                      {match.stats.drop_successes}/{match.stats.drop_attempts} drops
                    </span>
                  )}
                  <span className="chip chip-quiet">#{match.matchNumber}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default MatchList
