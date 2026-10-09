// ============================================================
// What the rating graph draws, worked out apart from drawing it.
//
// The server sends rounded PPR after every match, with when it ended.
// Everything here turns that into the steps of one line, and reads the
// headline, the high and the low off the line AS DRAWN -- so the words
// above the graph and the symbols on it can never disagree.
//
// Week steps by day played, Month by calendar month played, All by
// match. Every line starts from where the player stood when its span
// began (seven days ago, or 1,500 before their first match), so even one
// step played is a line of two points, never a lone dot.
//
// Days, weeks and months are the reader's own, in their local time: a
// match at 11pm belongs to the day they played it.
// ============================================================

export const START = 1500
const DAY = 86_400_000

/** "+6", "−4" or "0", with a true minus sign. */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

/** The colour class for a change: up, down, or neither. */
export const changeClass = (n) => (n > 0 ? 'is-up' : n < 0 ? 'is-down' : '')

/** "+6 PPR in the last 7 days", from a view's headline. */
export function changeWords({ change, words }) {
  if (change > 0) return `+${change} PPR ${words}`
  if (change < 0) return `−${Math.abs(change)} PPR ${words}`
  return `Level ${words}`
}

/** The arrow drawn before those words; none when the rating is level. */
export const changeIcon = (n) => (n > 0 ? 'arrowUp' : n < 0 ? 'arrowDown' : null)

const localDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
const localMonth = (date) => date.getFullYear() * 12 + date.getMonth()

/**
 * The PPR at the end of each group of matches, oldest first. `keyOf`
 * decides what a group is (a day, a week); the step is dated by the
 * group's last match.
 */
function closeOfEach(matches, keyOf) {
  const steps = []
  let lastKey = null
  for (const match of matches) {
    const at = new Date(match.at)
    const key = keyOf(at)
    if (key === lastKey) steps[steps.length - 1] = { value: match.points, at }
    else steps.push({ value: match.points, at })
    lastKey = key
  }
  return steps
}

/** Where they stood at `cutoff`, and the matches after it. */
function splitAt(matches, cutoff) {
  const inside = matches.findIndex((match) => Date.parse(match.at) > cutoff)
  const start = inside === -1 ? matches.length : inside
  return { from: start === 0 ? START : matches[start - 1].points, matches: matches.slice(start) }
}

/** Each step's change from the one before it; the first has none. */
function withChanges(points) {
  return points.map((point, i) => (i === 0 ? point : { ...point, change: point.value - points[i - 1].value }))
}

/**
 * The high and the low of a line, with where to put their symbols. A
 * symbol is left off when it would sit on "now", which has its own, and
 * both are left off a line that never moved. The later of two equal
 * spots wins: it is the one the player remembers.
 */
function extremes(points) {
  const values = points.map((point) => point.value)
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  const last = values.length - 1
  const highIndex = values.lastIndexOf(highest)
  const lowIndex = values.lastIndexOf(lowest)
  const moved = highest !== lowest
  return {
    highest,
    lowest,
    highIndex: moved && highIndex !== last ? highIndex : null,
    lowIndex: moved && lowIndex !== last ? lowIndex : null,
  }
}

/**
 * A line over the last `days` days: one step per day played, from where
 * they stood when the span began. `empty` when they played none of them.
 */
function spanView({ from, matches }, days, now) {
  const cutoff = new Date(now - days * DAY)
  if (matches.length === 0) return { empty: true }
  const points = withChanges([{ value: from, at: cutoff }, ...closeOfEach(matches, localDay)])
  const last = points[points.length - 1].value
  return {
    points,
    ...extremes(points),
    headline: { change: last - from, words: `in the last ${days} days` },
    step: 'day',
  }
}

/** The overview card's line: the last seven days, as the server sent them. */
export function weekView(lastWeek, now = Date.now()) {
  return { ...spanView(lastWeek, 7, now), ticks: 'days' }
}

/** "September", or "December 2025" when it isn't this year. */
function monthWords(date) {
  return date.getFullYear() === new Date().getFullYear()
    ? date.toLocaleDateString(undefined, { month: 'long' })
    : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * Month by month since the first match: 1,500 before it, then where each
 * month they played closed, so a step is every match of that month
 * combined. A month with no match is not a step. The headline is the
 * latest month's change.
 */
function monthView(matches) {
  const points = withChanges([{ value: START, at: new Date(matches[0].at) }, ...closeOfEach(matches, localMonth)])
  const latest = points[points.length - 1]
  return {
    points,
    ...extremes(points),
    headline: { change: latest.change, words: `in ${monthWords(latest.at)}` },
    step: 'month',
    ticks: 'months',
    startLine: true,
  }
}

/**
 * Everything since the first match: 1,500 before it, then one step per
 * match. The headline counts up from their lowest, so a player who
 * dropped and worked their way back sees the whole climb; it counts from
 * the first match instead when the lowest was the start or is where
 * they are now.
 */
function allView(matches) {
  const startedAt = new Date(matches[0].at)
  const points = [{ value: START, at: startedAt }, ...matches.map((match) => ({ value: match.points, at: new Date(match.at) }))]
  const last = points.length - 1
  const lowAt = points.map((point) => point.value).lastIndexOf(Math.min(...points.map((point) => point.value)))
  const fromLowest = lowAt !== 0 && lowAt !== last
  const now = points[last].value
  return {
    points,
    ...extremes(points),
    headline: fromLowest
      ? { change: now - points[lowAt].value, words: 'since your lowest' }
      : { change: now - START, words: 'since your first match' },
    step: 'match',
    ticks: 'ends',
    startedAt,
    startLine: true,
  }
}

/** What the graph page draws for one filter. `matches` is the whole history, oldest first. */
export function graphView(matches, filter, now = Date.now()) {
  if (filter === 'all') return allView(matches)
  if (filter === 'month') return monthView(matches)
  return { ...spanView(splitAt(matches, now - 7 * DAY), 7, now), ticks: 'days' }
}
