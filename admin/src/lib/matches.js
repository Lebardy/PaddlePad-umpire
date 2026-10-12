// ============================================================
// Words and rules for one match's page and the links to it. Pure, so
// they can be checked without a browser (scripts/check-matches.mjs).
// ============================================================

/** Whether a link to a match would open for this admin: the server answers 404 outside their facility. */
export function mayOpenMatch(me, facilityId) {
  return me.role === 'owner' || (facilityId != null && facilityId === me.facilityId)
}

/** "12–9 · Put-away · Jan": the score after the point, how it ended, and who did it when that is known. */
export function pointLine(point) {
  return [`${point.a}–${point.b}`, point.label, point.by].filter(Boolean).join(' · ')
}

/** The icon on a point's row: a tick for a winning shot, a cross for a mistake. */
export function pointMark(point) {
  return point.how === 'winner' ? 'check' : 'x'
}

/** A point as a screen reader is told it, in place of its bar and mark: whose it was, the score, and how it ended, by whom. */
export function pointSaid(point, side) {
  const how = point.how === 'winner' ? 'winning shot' : 'mistake'
  // "Mistake" and "Winning shot" are labels too: said once.
  const label = point.label?.toLowerCase() === how ? null : point.label
  return [`${side}: ${point.a}–${point.b}`, label, point.by ? `${how} by ${point.by}` : how].filter(Boolean).join(', ')
}

/** Stored video in GB to one decimal; anything at all shows as at least 0.1, so "some" never reads as none. */
export function sizeText(bytes) {
  if (bytes === 0) return '0 GB'
  return `${Math.max(0.1, bytes / 1e9).toFixed(1)} GB`
}

/**
 * The point a video is showing at `at` seconds: the last one whose rally
 * has started, or null before the first. `seconds[i]` is null for a
 * point the video does not show.
 */
export function playingIndex(seconds, at) {
  let playing = null
  seconds.forEach((second, index) => {
    // A quarter second of grace: a jump lands a hair before the second asked for.
    if (second !== null && second <= at + 0.25) playing = index
  })
  return playing
}

/**
 * Where the points' pane scrolls to so the point the video is on is in
 * view (in the middle), or null to leave it. It keeps up only while the
 * point lit before was still in view: once the list has been scrolled
 * away to look for another point, it is left where the hand put it.
 * `pane` is { top, height } (top is how far it is scrolled); a row is
 * { top, height } measured inside the pane's whole list.
 */
export function followScroll(pane, row, before) {
  const inView = (r) => r.top >= pane.top && r.top + r.height <= pane.top + pane.height
  if (inView(row) || (before && !inView(before))) return null
  return Math.max(0, row.top - (pane.height - row.height) / 2)
}
