/**
 * How the lead moved through one match, from this player's side.
 *
 * A single series against a zero baseline, so it is a line rather than
 * two lines of raw scores: what a reader wants is "was I ahead or
 * behind, and when did that change", and one line crossing a baseline
 * answers that instantly where two climbing lines make you do the
 * subtraction yourself.
 *
 * Above the line is coloured as good and below as critical, with the
 * baseline itself visible -- the crossings ARE the story.
 *
 * `size` switches between the thumbnail in a list row and the full-width
 * version on a match's own screen. It has to be a CLASS rather than a
 * bigger `height`, because height only sets the viewBox here -- the
 * rendered height comes from CSS, so passing a larger number would
 * change the aspect distortion and nothing else.
 */
function Sparkline({ margins, won, height = 34, size = 'sm' }) {
  if (!margins || margins.length < 2) return null

  const peak = Math.max(1, ...margins.map((m) => Math.abs(m)))
  const width = 100 // viewBox units; the SVG scales to its container
  const midY = height / 2

  const x = (i) => (i / (margins.length - 1)) * width
  const y = (m) => midY - (m / peak) * (midY - 3)

  const line = margins.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(m).toFixed(2)}`).join(' ')
  const area = `M0,${midY} ${margins.map((m, i) => `L${x(i).toFixed(2)},${y(m).toFixed(2)}`).join(' ')} L${width},${midY} Z`

  const last = margins[margins.length - 1]

  return (
    <svg
      className={`spark spark-${size}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={
        `Score margin through the match, ending ${last > 0 ? last + ' ahead' : last < 0 ? Math.abs(last) + ' behind' : 'level'}`
      }
    >
      {/* Everything is read against this line, so it is drawn, not implied. */}
      <line
        className="spark-base"
        x1="0" y1={midY} x2={width} y2={midY}
        vectorEffect="non-scaling-stroke"
      />
      <path className={`spark-area ${won ? 'won' : 'lost'}`} d={area} />
      <path
        className={`spark-line ${won ? 'won' : 'lost'}`}
        d={line}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default Sparkline
