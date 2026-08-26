// ============================================================
// Win rate over a sliding window of recent matches.
//
// A SECOND chart rather than a generalised Sparkline, deliberately.
// Sparkline draws a signed margin against a zero baseline, coloured
// good above and bad below -- that is a different mark from an unsigned
// 0-100% series against a 50% reference. Bending one component to do
// both would make both harder to read and harder to change.
//
// It borrows the technique though: inline SVG, no charting dependency,
// a drawn reference line, and one full-sentence aria-label rather than
// per-point markup a screen reader would have to wade through.
// ============================================================

const WIDTH = 300
const HEIGHT = 90

function TrendChart({ points, window: windowSize }) {
  if (points.length < 2) return null

  const step = WIDTH / (points.length - 1)
  const y = (value) => HEIGHT - value * HEIGHT
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${y(p.value)}`)
    .join(' ')

  const first = Math.round(points[0].value * 100)
  const last = Math.round(points[points.length - 1].value * 100)
  const direction = last > first ? 'up' : last < first ? 'down' : 'level'

  return (
    <section className="trend" aria-label="Recent form">
      <div className="trend-head">
        <h2>Form</h2>
        <span className="trend-now">{last}%</span>
      </div>

      <svg
        className="trend-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Win rate over the last ${windowSize} matches, from ${first} percent to ${last} percent — trending ${direction}.`}
      >
        {/* The 50% line is the thing every point is read against, so it
            is drawn rather than implied. */}
        <line
          className="trend-baseline"
          x1="0"
          y1={y(0.5)}
          x2={WIDTH}
          y2={y(0.5)}
        />
        <path className="trend-line" d={line} />
      </svg>

      <p className="trend-caption">
        Win rate across every {windowSize} matches in a row. The line is
        halfway up when you win as often as you lose.
      </p>
    </section>
  )
}

export default TrendChart
