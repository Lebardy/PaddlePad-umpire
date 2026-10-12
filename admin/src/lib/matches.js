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
