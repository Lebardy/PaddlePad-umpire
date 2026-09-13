// The player's own points after each recent match, as a line with no
// numbers on it. It only moves when they play, so the shape is honest;
// the exact value is already the headline above it.
const WIDTH = 300
const HEIGHT = 56
const MIN_SPAN = 20

function PointsTrend({ trend }) {
  if (!trend || trend.length < 2) return null
  const low = Math.min(...trend)
  const high = Math.max(...trend)
  const span = Math.max(high - low, MIN_SPAN)
  const floor = low - (span - (high - low)) / 2
  const step = WIDTH / (trend.length - 1)
  const y = (value) => HEIGHT - ((value - floor) / span) * HEIGHT
  const line = trend.map((value, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${y(value).toFixed(1)}`).join(' ')
  const first = trend[0]
  const last = trend[trend.length - 1]
  const direction = last > first ? 'up' : last < first ? 'down' : 'level'

  return (
    <svg
      className="points-trend"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Your points over your last ${trend.length} matches, from ${first} to ${last}: ${direction}.`}
    >
      <path className="points-trend-line" d={line} />
    </svg>
  )
}

export default PointsTrend
