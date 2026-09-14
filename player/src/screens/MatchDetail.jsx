// ============================================================
// One match, in full.
//
// Every figure here was already in the payload the list screen used --
// duration, singles or doubles, stacking and the per-match shot
// breakdown were all being sent and thrown away. So the screen draws
// instantly from the history the provider already holds.
//
// The one thing it does fetch is the point-by-point reading, and only
// once the match is opened: a reading of every match in a long history
// would be tens of kilobytes on every launch for something most visits
// never look at. It arrives after the page and adds itself to the
// bottom; nothing above waits for it.
// ============================================================

import { useEffect, useState } from 'react'
import { Link, navigate } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { fetchMatchGame } from '../lib/api'
import { longestRun, matchStory, turningPoint } from '../lib/story'
import Sparkline from '../components/Sparkline'
import MomentumRibbon from '../components/MomentumRibbon'
import Icon from '../components/Icon'
import StackedBar from '../components/StackedBar'
import Meter from '../components/Meter'
import RallyEndings from '../components/RallyEndings'

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

function signed(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

/**
 * This match's change in the player's rally points, once they are rated,
 * and under it how much came from the rallies and how much from the
 * result. The rallies figure is the change minus the reward, so the two
 * always add up to the line above even after rounding. Their own numbers
 * only; null (not rated yet) shows nothing.
 */
function MatchPoints({ rally, won }) {
  if (!rally || rally.change === null) return null
  const { change, result } = rally
  const unit = Math.abs(change) === 1 ? 'point' : 'points'
  return (
    <>
      <p className={`match-points ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`}>
        {change > 0 && `▲ +${change} ${unit} in this match`}
        {change < 0 && `▼ −${Math.abs(change)} ${unit} in this match`}
        {change === 0 && 'No change in points'}
      </p>
      {result !== null && (
        <p className="match-points-split">
          Rallies {signed(change - result)} · {won ? 'Winning' : 'Losing'} the match {signed(result)}
        </p>
      )}
    </>
  )
}

/**
 * Who was favoured before this match, from rally points, in words only.
 *
 * The server sends a verdict and never a figure: in doubles a side's
 * points are two people, one of them the reader, so a number would hand
 * over their partner's points. Absent when anyone on court had fewer than
 * five matches beforehand -- a missing line is better than a guess.
 */
function Expectation({ match }) {
  const what = match.rally?.expectation
  if (!what) return null

  const said = {
    even: 'Evenly matched.',
    win: what.margin === 'clear' ? 'You were expected to win comfortably.' : 'You were slight favourites.',
    loss: what.margin === 'clear' ? 'You were expected to lose.' : 'You were slight underdogs.',
  }[what.expected]

  return (
    <p className="expectation">
      {what.upset && (
        <span className="expectation-upset">{what.expected === 'loss' ? 'Upset' : 'Slip'}</span>
      )}
      <span>{said}</span>
    </p>
  )
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
  const hasEndings = (match.rally?.endings?.length ?? 0) > 0

  // Newest first, so the NEXT match chronologically is the previous index.
  const newer = index > 0 ? matches[index - 1] : null
  const older = index < matches.length - 1 ? matches[index + 1] : null

  return (
    <div className="detail">
      <BackLink />

      <header className={`match-board ${match.won ? 'won' : match.won === false ? 'lost' : ''}`}>
        <p className="result-word">
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
        <MatchPoints rally={match.rally} won={match.won} />
        {/* Nothing at all when anyone on court had fewer than five
            matches beforehand. A missing line is better than a hedged one. */}
        <Expectation match={match} />
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
        {(run >= 3 || turn) && (
          <ul className="ichips" aria-label="Moments">
            {run >= 3 && (
              <li className="ichip">
                <Icon name="flame" size={15} />
                <span>{run} in a row</span>
              </li>
            )}
            {turn && (
              <li className="ichip">
                <Icon name="swap" size={15} />
                <span>
                  Led for good at {turn.yours}&ndash;{turn.theirs}
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* The same ribbon the match of the month uses, from this player's
          side: their points filled, their opponents' outlined. Fetched
          for this match alone -- see fetchMatchGame. */}
      <PointByPoint id={match.id} match={match} />

      <section className="detail-stats" aria-label="Your shots in this match">
        <h2>{hasEndings ? 'How your rallies ended' : 'Your shots'}</h2>

        {hasEndings ? (
          <RallyEndings rally={match.rally} />
        ) : winners > 0 ? (
          // A match scored before rallies recorded how they ended: the
          // older split is all there is to show.
          <StackedBar
            total={winners}
            segments={[
              { label: 'Away from the net', value: stats.clean_winners ?? 0, className: 'seg-1' },
              { label: 'At the net (dinks)', value: stats.dink_winners ?? 0, className: 'seg-2' },
            ]}
          />
        ) : (
          <p className="muted-inline">No winning shots in this match.</p>
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
          <li className="chip">{winners} winning shots</li>
          <li className="chip">{errors} mistakes</li>
          {stats.drive_attempts > 0 && (
            <li className="chip">{stats.drive_attempts} drives</li>
          )}
        </ul>
      </section>

      {/* `replace`, not a push. Stepping between matches is movement
          BETWEEN SIBLINGS, not deeper into the app, so it must not
          stack history entries: without this, walking 5 -> 4 -> 3 left
          [list, 5, 4, 3] behind, and Back retraced that stack one match
          at a time -- doing exactly what "Next match" already does, and
          taking three presses to escape a screen you entered once.
          Replacing keeps the stack at [list, currentMatch], so Back
          means "leave the match", which is what BackLink below promises
          and what returns you to the list with its scroll intact. */}
      <nav className="detail-nav" aria-label="Other matches">
        {older ? (
          <Link className="detail-nav-link" replace to={`/matches/${older.id}`}>
            &larr; Previous match
          </Link>
        ) : (
          <span />
        )}
        {newer && (
          <Link className="detail-nav-link" replace to={`/matches/${newer.id}`}>
            Next match &rarr;
          </Link>
        )}
      </nav>
    </div>
  )
}

/**
 * Every point of this match, once it has been asked for.
 *
 * Renders nothing at all until the reading arrives, and nothing ever if
 * it fails: the page above it is already complete without this, and an
 * error box for a nice-to-have would be worse than its absence.
 */
function PointByPoint({ id, match }) {
  // Kept with the id it belongs to, rather than cleared and refetched:
  // opening the next match from the arrows at the foot of this page
  // swaps the id, and a stale ribbon must not show under a new match.
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchMatchGame(id, { signal: controller.signal })
      .then((data) => setLoaded({ id, game: data.game }))
      .catch(() => {})
    return () => controller.abort()
  }, [id])

  const game = loaded?.id === id ? loaded.game : null
  if (!game || game.moments.length === 0) return null

  const theirs = match.opponents.join(' & ')
  return (
    <section className="detail-shape" aria-label="Point by point">
      <h2>Point by point</h2>
      <MomentumRibbon
        moments={game.moments}
        path={game.path}
        // The reading is told from this player's side, so "winners"
        // here means their team whether they won or lost.
        asShown={({ winners, losers }) => `${winners}–${losers}`}
        winners={match.partner ? `You & ${match.partner}` : 'You'}
        losers={theirs}
        lowIndex={game.lowPoint ? game.lowPoint.index : null}
      />
    </section>
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
