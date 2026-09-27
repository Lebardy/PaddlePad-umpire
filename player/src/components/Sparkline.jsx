import { useId } from 'react'
import PointMark, { ChartLevel } from './PointMark'

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
 *
 * The big one also says where level is -- a "0" at the start of the
 * middle line -- and lights up `highlight`, the point picked in the
 * boxes further down the screen. It is shaded green wherever you were
 * ahead and red wherever you were behind, where the thumbnail takes one
 * colour from the result: the big one has room to tell the whole story.
 */
function Sparkline({ margins, won, height = 34, size = 'sm', highlight = null }) {
  // Before the early return, as hooks must be. Stripped to letters and
  // digits so it is safe inside url(#...).
  const clip = `spark${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  if (!margins || margins.length < 2) return null

  const peak = Math.max(1, ...margins.map((m) => Math.abs(m)))
  const width = 100 // viewBox units; the SVG scales to its container
  const midY = height / 2

  // The thumbnail runs edge to edge. The big one gives every point an
  // equal slot and draws it in the middle, so a lit-up point's column is
  // the same width and centred on it, the first and last included.
  const x = size === 'lg'
    ? (i) => ((i + 0.5) / margins.length) * width
    : (i) => (i / (margins.length - 1)) * width
  const y = (m) => midY - (m / peak) * (midY - 3)

  const line = margins.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(m).toFixed(2)}`).join(' ')
  const area = `M${x(0).toFixed(2)},${midY} ${margins.map((m, i) => `L${x(i).toFixed(2)},${y(m).toFixed(2)}`).join(' ')} L${x(margins.length - 1).toFixed(2)},${midY} Z`

  const last = margins[margins.length - 1]

  const svg = (
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
      {size === 'lg' ? (
        // The same line and shading twice, each cut to one side of the
        // middle: green where you were ahead, red where you were behind.
        <>
          <defs>
            <clipPath id={`${clip}-ahead`}>
              <rect x="0" y={-height} width={width} height={midY + height} />
            </clipPath>
            <clipPath id={`${clip}-behind`}>
              <rect x="0" y={midY} width={width} height={midY + height} />
            </clipPath>
          </defs>
          {['ahead', 'behind'].map((side) => (
            <g key={side} className={`spark-${side}`} clipPath={`url(#${clip}-${side})`}>
              <path className="spark-area" d={area} />
              <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </>
      ) : (
        <>
          <path className={`spark-area ${won ? 'won' : 'lost'}`} d={area} />
          <path
            className={`spark-line ${won ? 'won' : 'lost'}`}
            d={line}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
  if (size !== 'lg') return svg

  // The boxes come from a separate request, so a point past the end of
  // this line is not drawn rather than drawn in the wrong place.
  const picked = highlight !== null && highlight < margins.length ? highlight : null
  return (
    <div className="spark-frame">
      <div className="spark-plot">
        {svg}
        <ChartLevel slots={margins.length} />
        {picked !== null && (
          <PointMark slot={picked} slots={margins.length} top={(y(margins[picked]) / height) * 100} />
        )}
      </div>
      <span className="chart-zero" aria-hidden="true">0</span>
    </div>
  )
}

export default Sparkline
