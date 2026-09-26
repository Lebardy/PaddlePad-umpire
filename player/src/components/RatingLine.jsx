// ============================================================
// The PaddlePad Rating as a line: the overview card's last seven days,
// and the graph page's Week, Month and All.
//
// Symbols only on the line -- ▲ the high, ▼ the low, ● now -- each
// centred exactly on its step. The numbers live in the headline and the
// Highest / Lowest card, where they can be read rather than squinted at.
// What each view steps by and what goes under it is ratingGraph.js's
// decision; this only draws it.
//
// The line draws left to right when it appears and whenever the filter
// changes (the parent re-keys it), then the symbols pop in. Nobody who
// asked their phone for less motion sees either.
// ============================================================

import { formatDate } from '../lib/format'
import { START, changeClass, monthStarts, signed } from '../lib/ratingGraph'

const WIDTH = 340
// Nothing under this many PPR fills the height: a two-point wobble
// drawn floor to ceiling would look like a collapse.
const MIN_SPAN = 20
// The closest two labels under the graph may sit, in viewBox units.
const LABEL_ROOM = 30


/** The date under the All view's first step; with the year only when it isn't this one. */
function startedLabel(date) {
  return date.getFullYear() === new Date().getFullYear()
    ? formatDate(date)
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Keep every label that has room after the last one kept; always keep the last. */
function spaced(indices, x) {
  const kept = []
  for (const i of indices) {
    if (kept.length === 0 || x(i) - x(kept[kept.length - 1]) >= LABEL_ROOM) kept.push(i)
    else if (i === indices[indices.length - 1]) kept[kept.length - 1] = i
  }
  return kept
}

function Ticks({ view, x, height }) {
  const { points, ticks } = view
  const last = points.length - 1
  const anchor = (i) => (i === 0 ? 'start' : i === last ? 'end' : 'middle')

  if (ticks === 'ends') {
    return (
      <>
        <text className="rl-tick" x={x(0)} y={height - 4} textAnchor="start">{startedLabel(view.startedAt)}</text>
        <text className="rl-tick" x={x(last)} y={height - 4} textAnchor="end">Today</text>
      </>
    )
  }

  if (ticks === 'months') {
    return spaced(monthStarts(points), x).map((i) => (
      <text key={i} className="rl-tick" x={x(i)} y={height - 4} textAnchor={anchor(i)}>
        {points[i].at.toLocaleDateString(undefined, { month: 'short' })}
      </text>
    ))
  }

  // Each day played: its date, and under it how that day changed things.
  // The first step is where the span began, so it has a date only.
  return spaced(points.map((_, i) => i), x).map((i, n, kept) => {
    const point = points[i]
    const previous = n > 0 ? points[kept[n - 1]].at : null
    const date = !previous || previous.getMonth() !== point.at.getMonth() ? formatDate(point.at) : String(point.at.getDate())
    return (
      <g key={i}>
        <text className="rl-tick" x={x(i)} y={height - 18} textAnchor={anchor(i)}>{date}</text>
        {i > 0 && (
          <text className={`rl-change ${changeClass(point.change)}`} x={x(i)} y={height - 4} textAnchor={anchor(i)}>
            {signed(point.change)}
          </text>
        )}
      </g>
    )
  })
}

/** A triangle centred on (cx, cy): pointing up for the high, down for the low. */
function triangle(cx, cy, up) {
  const s = up ? 1 : -1
  return `M${cx - 6} ${cy + 3.5 * s} L${cx + 6} ${cy + 3.5 * s} L${cx} ${cy - 7 * s} Z`
}

function RatingLine({ view, compact = false, label }) {
  const { points, startLine } = view
  const height = compact ? 124 : 196
  const padTop = 12
  const padBottom = view.ticks === 'days' ? 38 : 24
  const padSide = 8

  const values = points.map((point) => point.value)
  const low = Math.min(...values, ...(startLine ? [START] : []))
  const high = Math.max(...values, ...(startLine ? [START] : []))
  const span = Math.max(high - low, MIN_SPAN)
  const floor = (high + low) / 2 - span / 2
  const last = points.length - 1
  const x = (i) => padSide + (i * (WIDTH - padSide * 2)) / Math.max(1, last)
  const y = (value) => padTop + ((floor + span - value) / span) * (height - padTop - padBottom)

  const line = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
  const baseline = height - padBottom
  const area = `${line} L${x(last).toFixed(1)} ${baseline} L${x(0).toFixed(1)} ${baseline} Z`
  const startY = y(START)

  return (
    <svg className={`rating-line${compact ? ' is-compact' : ''}`} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <path className="rl-area" d={area} />
      {startLine && (
        <>
          <line className="rl-start" x1="0" x2={WIDTH} y1={startY} y2={startY} />
          <text className="rl-start-label" x={WIDTH} y={startY > baseline - 14 ? startY - 5 : startY + 13} textAnchor="end">
            1,500
          </text>
        </>
      )}
      <path className="rl-line" d={line} pathLength="1" />
      {view.highIndex !== null && (
        <path className="rl-mark rl-high" d={triangle(x(view.highIndex), y(points[view.highIndex].value), true)} />
      )}
      {view.lowIndex !== null && (
        <path className="rl-mark rl-low" d={triangle(x(view.lowIndex), y(points[view.lowIndex].value), false)} />
      )}
      <circle className="rl-mark rl-now" cx={x(last)} cy={y(values[last])} r="5.5" />
      <Ticks view={view} x={x} height={height} />
    </svg>
  )
}

export default RatingLine
