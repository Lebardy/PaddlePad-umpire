// ============================================================
// One line describing how a match went, read off its score margins.
//
// Everything here is a fact about that single match -- no averages, no
// comparison to other players -- so it stays true from the very first
// match and can never shift because someone else played.
// ============================================================

/** The longest run of consecutive points by this player's team. */
export function longestRun(margins) {
  let best = 0
  let run = 0
  let previous = 0
  for (const margin of margins) {
    if (margin > previous) {
      run += 1
      best = Math.max(best, run)
    } else {
      run = 0
    }
    previous = margin
  }
  return best
}

/**
 * The most interesting single thing about the match, or null when
 * nothing stands out -- better to say nothing than to dress up an
 * ordinary game.
 */
export function matchStory(margins, won) {
  if (!margins || margins.length < 3) return null

  const worst = Math.min(...margins)
  const best = Math.max(...margins)
  const run = longestRun(margins)

  if (won && worst <= -4) return `Came back from ${Math.abs(worst)} down`
  if (won && worst >= 0) return 'Never trailed'
  if (!won && best >= 4) return `Led by ${best} at one point`
  if (run >= 5) return `${run} points in a row`
  if (won && worst <= -2) return `Trailed by ${Math.abs(worst)} early on`
  return null
}
