// ============================================================
// Dates, written the way the screens actually want them.
//
// formatDate lived inside MatchList, which was fine while it had one
// caller. The People tab needs the same rendering, and two copies of a
// date format is how two screens end up disagreeing about what day
// something happened.
// ============================================================

/** "5 Sep" -- a match's date, in the reader's own locale order. */
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * When you last shared a court with someone.
 *
 * Relative for the recent past and absolute beyond it, because "today"
 * and "3 days ago" are what make a list of names feel like people you
 * actually played rather than rows in a table -- while "97 days ago"
 * would be arithmetic nobody asked for.
 */
export function lastPlayedLabel(iso) {
  if (!iso) return ''

  // Compared by calendar day, not by elapsed hours: a match at 9pm
  // yesterday and one at 1am today are 4 hours apart but are plainly
  // "yesterday" and "today" to the person who played them.
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(then)) / 86400000,
  )

  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return formatDate(iso)
}
