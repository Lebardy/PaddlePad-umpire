// ============================================================
// The PaddlePad Rating card: the player's PPR, what it means, and how
// the last seven days moved it -- and never a comparison with anyone
// else. PaddlePad will be a small group for a long time, and a place or
// percentile jumps every time one person joins or plays. PPR only moves
// when you do.
//
// "PPR" rather than "points", which already means the points of a game.
// ============================================================

import { formatDate } from '../lib/format'
import { changeClass, changeWords, weekView } from '../lib/ratingGraph'
import { Link } from '../lib/router'
import Meter from './Meter'
import RatingLine from './RatingLine'

const START = 1500

/**
 * The last seven days, as a way into the graph page: the change, the
 * line, and a tap anywhere on them opens the full graph. A week with no
 * matches says when they last played instead.
 */
function LastWeek({ rallyRating }) {
  const view = rallyRating.lastWeek ? weekView(rallyRating.lastWeek) : { empty: true }
  return (
    <Link className="points-week" to="/rating/graph">
      {view.empty ? (
        <p className="points-quiet">
          No matches in the last 7 days.
          {rallyRating.lastPlayedAt && <> You last played on {formatDate(rallyRating.lastPlayedAt)}.</>}
        </p>
      ) : (
        <>
          <p className={`points-change ${changeClass(view.headline.change)}`}>{changeWords(view.headline)}</p>
          <RatingLine
            view={view}
            compact
            label={`Your PaddlePad Rating over the last 7 days, from ${view.points[0].value.toLocaleString()} to ${rallyRating.points.toLocaleString()}.`}
          />
        </>
      )}
      <span className="points-graph-more">See your graph &rarr;</span>
    </Link>
  )
}

/**
 * The PPR and its anchors, shared with the rating screen. Under ten
 * matches it is marked as an early estimate, in words only: no counts
 * and no reliability figure.
 */
export function RallyPointsHeadline({ rallyRating }) {
  return (
    <>
      <p className="points-figure">
        {rallyRating.points.toLocaleString()} <span className="points-unit">PPR</span>
      </p>
      {rallyRating.earlyEstimate && (
        <p className="points-early">
          <span className="points-early-tag">Early estimate<span className="points-early-stop">.</span></span>{' '}
          Based on only a few games so far. It will settle as you play more, and against more people.
        </p>
      )}
      <LastWeek rallyRating={rallyRating} />
      <p className="points-anchor">
        Everyone starts at {START.toLocaleString()} PPR. You&rsquo;d win about{' '}
        <strong>{rallyRating.winChanceVsStart} of every 100</strong> rallies against a{' '}
        {START.toLocaleString()} player.
      </p>
      <p className="points-basis">
        Based on {rallyRating.rallies.toLocaleString()} rallies · {rallyRating.matches} matches
      </p>
    </>
  )
}

/** Progress towards a rating, shared with the rating screen. */
export function RallyProgress({ rallyRating }) {
  const left = rallyRating.need - rallyRating.have
  return (
    <>
      <Meter
        label="Matches played"
        valueText={`${rallyRating.have} of ${rallyRating.need}`}
        value={Math.min(1, rallyRating.have / rallyRating.need)}
        caption={left === 1 ? 'One to go.' : `${left} to go.`}
      />
      <p className="muted-inline">
        A couple of matches can&rsquo;t tell a good day from a good player.
      </p>
    </>
  )
}

function RallyRating({ rallyRating }) {
  if (!rallyRating) return null

  if (rallyRating.state === 'not_enough_matches') {
    return (
      <section className="rating rating-progress" aria-label="PaddlePad Rating">
        <h2>PaddlePad Rating</h2>
        <RallyProgress rallyRating={rallyRating} />
      </section>
    )
  }

  return (
    <section className="rating rating-points" aria-label="PaddlePad Rating">
      <h2>PaddlePad Rating</h2>
      <RallyPointsHeadline rallyRating={rallyRating} />
      <Link className="rating-more" to="/rating">
        What&rsquo;s moving it &rarr;
      </Link>
    </section>
  )
}

export default RallyRating
