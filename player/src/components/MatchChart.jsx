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
// ============================================================

/**
 * @param {number[]} margins - the lead after each point, winners' side
 * @param {Array<{index: number, label: string, place: 'above'|'below'}>} markers
 */
function MatchChart({ margins, markers }) {
  const n = margins.length
  // A little headroom, so the extremes are not drawn on the edge.
  const reach = Math.max(1, ...margins.map(Math.abs)) + 1
  const y = (m) => reach - m
  const points = [`0,${reach}`, ...margins.map((m, i) => `${i + 1},${y(m)}`)]

  return (
    <div className="mchart">
      <svg
        className="mchart-svg"
        viewBox={`0 0 ${n} ${reach * 2}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`How the lead moved over ${n} points. ${markers
          .map((m) => m.label)
          .join(', ')}.`}
      >
        <line className="mchart-base" x1="0" y1={reach} x2={n} y2={reach} vectorEffect="non-scaling-stroke" />
        <polygon className="mchart-area" points={`${points.join(' ')} ${n},${reach}`} />
        <polyline className="mchart-line" points={points.join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>

      {markers.map((marker) => {
        const left = ((marker.index + 1) / n) * 100
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
    </div>
  )
}

export default MatchChart
