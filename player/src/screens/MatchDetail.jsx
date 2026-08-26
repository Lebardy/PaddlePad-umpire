// ============================================================
// One match, in full.
//
// Every figure here was already in the payload the list screen used --
// duration, singles or doubles, stacking and the per-match shot
// breakdown were all being sent and thrown away. So this screen costs
// no extra request: it reads out of the history the provider already
// holds, which is why opening a match is instant.
// ============================================================

import { Link, navigate } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { longestRun, matchStory, turningPoint } from '../lib/story'
import Sparkline from '../components/Sparkline'
import StackedBar from '../components/StackedBar'
import Meter from '../components/Meter'

// Both timestamps come from a device clock, and startedAt is when the
// umpire CREATED the match rather than when play began -- a match set up
// early and started late would read as hours long. Outside a plausible
// window the honest thing is to say nothing, the same way the server
// sends null rather than a made-up ratio.
const MIN_PLAUSIBLE_MINS = 2
const MAX_PLAUSIBLE_MINS = 180

function durationMins(match) {
  if (!match.startedAt || !match.endedAt) return null
  const mins = Math.round(
    (new Date(match.endedAt) - new Date(match.startedAt)) / 60000,
  )
  return mins >= MIN_PLAUSIBLE_MINS && mins <= MAX_PLAUSIBLE_MINS ? mins : null
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function MatchDetail({ id }) {
  const { matches, loading } = usePlayerData()
  const index = matches.findIndex((m) => m.id === id)
  const match = index === -1 ? null : matches[index]

  if (!match) {
    // While the first load is still running there is nothing to look up
    // yet, so this is "not loaded" rather than "does not exist".
    return (
      <div className="detail">
        <BackLink />
        <p className="muted">{loading ? 'Loading…' : 'That match isn’t in your history.'}</p>
      </div>
    )
  }

  const stats = match.stats ?? {}
  const winners = (stats.clean_winners ?? 0) + (stats.dink_winners ?? 0)
  const errors = (stats.unforced_errors ?? 0) + (stats.dink_errors ?? 0)
  const thirdShots = (stats.drop_attempts ?? 0) + (stats.drive_attempts ?? 0)
  const mins = durationMins(match)
  const story = matchStory(match.progression, match.won, match.pointTarget)
  const run = longestRun(match.progression ?? [])
  const turn = turningPoint(match.progression ?? [])

  // Newest first, so the NEXT match chronologically is the previous index.
  const newer = index > 0 ? matches[index - 1] : null
  const older = index < matches.length - 1 ? matches[index + 1] : null

  return (
    <div className="detail">
      <BackLink />

      <header className={`detail-head ${match.won ? 'won' : match.won === false ? 'lost' : ''}`}>
        <p className="eyebrow">
          {match.won === null ? 'No result' : match.won ? 'Won' : 'Lost'}
        </p>
        <p className="detail-score">
          <span className="ds-yours">{match.yourScore}</span>
          <span className="ds-dash">&ndash;</span>
          <span className="ds-theirs">{match.theirScore}</span>
        </p>
        <p className="detail-versus">vs {(match.opponents ?? []).join(' & ')}</p>
        {match.partner && <p className="detail-partner">with {match.partner}</p>}
        <p className="detail-meta">
          {formatDate(match.endedAt)} · {match.sessionName}
        </p>
      </header>

      <ul className="fact-chips" aria-label="Match details">
        <li className="chip">{match.isDoubles ? 'Doubles' : 'Singles'}</li>
        {match.pointTarget !== 11 && <li className="chip">To {match.pointTarget}</li>}
        {mins !== null && <li className="chip">{mins} min</li>}
        {match.usedStacking && <li className="chip">Stacked</li>}
        {match.endedEarly && <li className="chip">Stopped early</li>}
        <li className="chip chip-quiet">Match #{match.matchNumber}</li>
      </ul>
      {match.usedStacking && (
        <p className="chip-note">
          Stacking means your team lined up on the same side before each serve
          to keep your stronger forehand in the middle.
        </p>
      )}

      <section className="detail-shape" aria-label="How the match went">
        <h2>How it went</h2>
        <Sparkline margins={match.progression} won={match.won} size="lg" />
        {story && <p className="detail-story">{story}</p>}
        <ul className="detail-notes">
          {run >= 3 && <li>Longest run: {run} points in a row</li>}
          {turn && (
            <li>
              Took the lead for good at {turn.yours}&ndash;{turn.theirs}
            </li>
          )}
        </ul>
      </section>

      <section className="detail-stats" aria-label="Your shots in this match">
        <h2>Your shots</h2>

        {winners > 0 ? (
          <StackedBar
            total={winners}
            segments={[
              { label: 'Away from the net', value: stats.clean_winners ?? 0, className: 'seg-1' },
              { label: 'At the net (dinks)', value: stats.dink_winners ?? 0, className: 'seg-2' },
            ]}
          />
        ) : (
          <p className="muted-inline">No winners logged in this match.</p>
        )}

        <div className="meters">
          <Meter
            label="Drops that landed"
            value={
              stats.drop_attempts > 0
                ? stats.drop_successes / stats.drop_attempts
                : null
            }
            caption={
              stats.drop_attempts > 0
                ? `${stats.drop_successes} of ${stats.drop_attempts} third-shot drops`
                : 'No third shots logged'
            }
          />
          <Meter
            label="Drop over drive"
            value={thirdShots > 0 ? (stats.drop_attempts ?? 0) / thirdShots : null}
            caption={
              thirdShots > 0
                ? `You chose the drop ${stats.drop_attempts} of ${thirdShots} times`
                : 'No third shots logged'
            }
          />
        </div>

        <ul className="fact-chips" aria-label="Totals">
          <li className="chip">{winners} winners</li>
          <li className="chip">{errors} errors</li>
          {stats.drive_attempts > 0 && (
            <li className="chip">{stats.drive_attempts} drives</li>
          )}
        </ul>
      </section>

      <nav className="detail-nav" aria-label="Other matches">
        {older ? (
          <Link className="detail-nav-link" to={`/matches/${older.id}`}>
            &larr; Previous match
          </Link>
        ) : (
          <span />
        )}
        {newer && (
          <Link className="detail-nav-link" to={`/matches/${newer.id}`}>
            Next match &rarr;
          </Link>
        )}
      </nav>
    </div>
  )
}

function BackLink() {
  return (
    <button
      type="button"
      className="back-link"
      // history.back() rather than a link to /matches, so arriving from
      // a person's page or from Your best returns you where you were --
      // including the scroll position the router saved.
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/matches'))}
    >
      &larr; Back
    </button>
  )
}

export default MatchDetail
