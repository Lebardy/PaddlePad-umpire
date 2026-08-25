// ============================================================
// Figures derived on the client from what the server already sent.
//
// Everything here is a plain count or ratio over this player's own
// matches. Nothing needs other players to exist, which is what makes it
// safe to show from the very first match -- unlike a skill rating,
// which is scaled against the whole club and would visibly move because
// SOMEONE ELSE played.
// ============================================================

/** Results of the most recent matches, newest first. */
export function recentForm(matches, count = 5) {
  return matches.slice(0, count).map((m) => ({ id: m.id, won: m.won }))
}

/**
 * The current run of wins or losses.
 *
 * Counts from the newest match backwards and stops at the first
 * different result. A match with no result (stopped at a tie) breaks a
 * streak rather than extending it either way.
 */
export function currentStreak(matches) {
  if (matches.length === 0 || matches[0].won === null) return null
  const won = matches[0].won
  let length = 0
  for (const match of matches) {
    if (match.won !== won) break
    length += 1
  }
  return { won, length }
}

/** The win with the biggest points margin, if there is one. */
export function bestWin(matches) {
  const wins = matches.filter((m) => m.won === true)
  if (wins.length === 0) return null
  return wins.reduce((best, m) =>
    m.yourScore - m.theirScore > best.yourScore - best.theirScore ? m : best,
  )
}

/** Who this player has partnered most, and how it went. */
export function topPartner(matches) {
  const tally = new Map()
  for (const match of matches) {
    if (!match.partner) continue
    const entry = tally.get(match.partner) ?? { name: match.partner, played: 0, won: 0 }
    entry.played += 1
    if (match.won === true) entry.won += 1
    tally.set(match.partner, entry)
  }
  if (tally.size === 0) return null
  return [...tally.values()].sort((a, b) => b.played - a.played)[0]
}
