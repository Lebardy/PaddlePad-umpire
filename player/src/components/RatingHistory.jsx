// ============================================================
// How this player's skill score has moved, and what pool each reading
// was taken against.
//
// A THIRD chart rather than a generalisation of the other two, for the
// same reason TrendChart is not a Sparkline: they draw different marks.
// Sparkline is a signed margin against a zero baseline. TrendChart is an
// unsigned percentage against a meaningful 50% reference. This is an
// absolute 0-100 score over time with no natural reference at all.
// Bending one component into all three would make each harder to read
// and harder to change.
//
// It borrows the technique -- inline SVG, no charting dependency, one
// full-sentence aria-label, colours from the validated tokens rather
// than picked by eye.
//
// The points are CHANGES, not runs. The pipeline is deterministic, so a
// nightly run over unchanged data reproduces the previous score exactly;
// the server collapses those before sending. See buildRatingHistory.
// ============================================================

const WIDTH = 300
const HEIGHT = 64

// The y-axis scales to this player's own range, but never to a span
// narrower than this.
//
// Both extremes are wrong on their own. A fixed 0-100 axis would flatten
// every real change into invisibility, since scores move by a few points
// at a time. A purely auto-scaled axis would do the opposite and blow a
// one-point wiggle up to the full height of the chart, which is a lie
// told with an honest number -- the median gap between two players is
// about half a point, so a single point of movement is nearly nothing.
// A floor on the span keeps small changes looking small.
const MIN_SPAN = 10

function describe(first, last) {
  const change = last.skillScore - first.skillScore
  if (change > 0) return `up ${change} since then`
  if (change < 0) return `down ${Math.abs(change)} since then`
  return 'unchanged since then'
}

function RatingHistory({ history }) {
  // One point is not a history, and saying so plainly beats drawing a
  // chart frame around a single dot. It is also the normal state for
  // anyone newly rated, so it should not read as something missing.
  if (!history || history.length < 2) {
    return (
      <p className="muted-inline rating-history-none">
        Your first rating — changes will show up here.
      </p>
    )
  }

  const scores = history.map((point) => point.skillScore)
  const low = Math.min(...scores)
  const high = Math.max(...scores)

  // Centre the actual range inside the enforced minimum span, so a small
  // change sits in the middle of the chart rather than being pinned to
  // an edge by an arbitrary choice of which end to pad.
  const span = Math.max(high - low, MIN_SPAN)
  const padding = (span - (high - low)) / 2
  const floor = low - padding

  const step = WIDTH / (history.length - 1)
  const x = (index) => index * step
  const y = (score) => HEIGHT - ((score - floor) / span) * HEIGHT

  const line = history
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(point.skillScore).toFixed(1)}`)
    .join(' ')

  const first = history[0]
  const last = history[history.length - 1]
  const poolGrew = last.poolSize !== first.poolSize

  const since = new Date(first.computedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })

  return (
    <div className="rating-history">
      <svg
        className="rating-history-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          `Your skill score since ${since}, from ${first.skillScore} to ` +
          `${last.skillScore} out of 100 — ${describe(first, last)}.`
        }
      >
        <path className="rating-history-line" d={line} />
        {/* Marked because each point is a discrete change rather than a
            sample of a continuous signal -- the dots are the events. */}
        {history.map((point, i) => (
          <circle
            key={point.computedAt}
            className="rating-history-dot"
            cx={x(i)}
            cy={y(point.skillScore)}
            r="3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <p className="rating-history-caption">
        {first.skillScore} on {since}, {last.skillScore} now.{' '}
        {/* The one place the pool-relative nature is spelled out. The
            card above used to say it too, which meant reading the same
            idea twice before reaching the chart that shows it. */}
        {poolGrew ? (
          <>
            The pool grew from {first.poolSize} to {last.poolSize} — your
            score can move when others play.
          </>
        ) : (
          <>Your score can move when others play, not only when you do.</>
        )}
      </p>
    </div>
  )
}

export default RatingHistory
