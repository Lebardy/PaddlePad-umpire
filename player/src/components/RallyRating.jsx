// ============================================================
// The skill rating card: points, what they mean, and where they are
// heading -- and never a comparison with anyone else. PaddlePad will be
// a small group for a long time, and a place or percentile jumps every
// time one person joins or plays. Points only move when you do.
// ============================================================

import { Link } from '../lib/router'
import Meter from './Meter'
import PointsTrend from './PointsTrend'

const START = 1500

function changeLine(change) {
  if (change > 0) return `▲ +${change} over your last 5 matches`
  if (change < 0) return `▼ −${Math.abs(change)} over your last 5 matches`
  return 'Level over your last 5 matches'
}

/** The points and their anchors, shared with the rating screen. */
export function RallyPointsHeadline({ rallyRating }) {
  return (
    <>
      <p className="points-figure">
        {rallyRating.points.toLocaleString()} <span className="points-unit">points</span>
      </p>
      <p className={`points-change ${rallyRating.recentChange > 0 ? 'is-up' : rallyRating.recentChange < 0 ? 'is-down' : ''}`}>
        {changeLine(rallyRating.recentChange)}
      </p>
      <p className="points-anchor">
        Everyone starts at {START.toLocaleString()}. You&rsquo;d win about{' '}
        <strong>{rallyRating.winChanceVsStart} of every 100</strong> rallies against a{' '}
        {START.toLocaleString()} player.
      </p>
      <PointsTrend trend={rallyRating.trend} />
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
      <section className="rating rating-progress" aria-label="Skill rating">
        <h2>Skill rating</h2>
        <RallyProgress rallyRating={rallyRating} />
      </section>
    )
  }

  return (
    <section className="rating rating-points" aria-label="Skill rating">
      <h2>Skill rating</h2>
      <RallyPointsHeadline rallyRating={rallyRating} />
      <Link className="rating-more" to="/rating">
        What&rsquo;s moving it &rarr;
      </Link>
    </section>
  )
}

export default RallyRating
