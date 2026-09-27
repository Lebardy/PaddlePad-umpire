// ============================================================
// How the lead moved through one game, with its key moments marked.
//
// For the match of the month. A bare line through twenty-six points is a
// squiggle; the same line with "1–4", "12–12" and "14–12" pinned to it
// is a story you can read at a glance -- the hole, the moment it was
// last level, the finish.
//
// Drawn from the winners' side, so above the line means the winners
// were ahead. The line itself is SVG stretched to fit, but the markers
// and labels are ordinary HTML laid over it, because text inside a
// stretched SVG stretches with it.
//
// A "0" in a margin of its own at the start of the middle line says that
// is where the score was level, and `highlight` lights up the point
// picked in the boxes further down the page.
// ============================================================

import PointMark, { ChartLevel } from './PointMark'

/**
 * @param {number[]} margins - the lead after each point, winners' side
 * @param {Array<{index: number, label: string, place: 'above'|'below'}>} markers
 * @param {number | null} [highlight] - the point to light up
 */
function MatchChart({ margins, markers, highlight = null }) {
  const n = margins.length
  // One equal slot for the level start and one for each point, every
  // one drawn in the middle of its slot -- so a lit-up point's column is
  // the same width and centred on it, the first and last included.
  const slots = n + 1
  const x = (slot) => slot + 0.5
  // A little headroom, so the extremes are not drawn on the edge.
  const reach = Math.max(1, ...margins.map(Math.abs)) + 1
  const y = (m) => reach - m
  const points = [`${x(0)},${reach}`, ...margins.map((m, i) => `${x(i + 1)},${y(m)}`)]
  const picked = highlight !== null && highlight < n ? highlight : null

  return (
    <div className="mchart">
      <div className="mchart-plot">
        <svg
          className="mchart-svg"
          viewBox={`0 0 ${slots} ${reach * 2}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`How the lead moved over ${n} points. ${markers
            .map((m) => m.label)
            .join(', ')}.`}
        >
          <polygon className="mchart-area" points={`${points.join(' ')} ${x(n)},${reach}`} />
          <polyline className="mchart-line" points={points.join(' ')} vectorEffect="non-scaling-stroke" />
        </svg>
        <ChartLevel slots={slots} />

        {markers.map((marker) => {
          const left = (x(marker.index + 1) / slots) * 100
          const top = (y(margins[marker.index]) / (reach * 2)) * 100
          // Pull labels in from the edges so the last one does not hang
          // off the right-hand side of a phone.
          const align = left > 88 ? 'end' : left < 12 ? 'start' : 'middle'
          return (
            <span
              key={marker.index}
              className={`mchart-mark mchart-${marker.place} mchart-${align}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-hidden="true"
            >
              <span className="mchart-dot" />
              <span className="mchart-label">{marker.label}</span>
            </span>
          )
        })}
        {picked !== null && (
          <PointMark slot={picked + 1} slots={slots} top={(y(margins[picked]) / (reach * 2)) * 100} />
        )}
      </div>
      <span className="chart-zero" aria-hidden="true">0</span>
    </div>
  )
}

export default MatchChart
