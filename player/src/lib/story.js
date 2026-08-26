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

// The thresholds below were chosen for a game to 11. They describe how
// big a swing has to be before it is worth remarking on, and that is a
// fraction of the game rather than a fixed number of points: being 4
// down in a game to 11 is most of the way to losing, while being 4 down
// in a game to 21 is an ordinary patch. Scaling them keeps a story from
// meaning something noticeably different depending on the format.
const STORY_BASE_TARGET = 11

function scaled(threshold, pointTarget) {
  return Math.round((threshold * (pointTarget || STORY_BASE_TARGET)) / STORY_BASE_TARGET)
}

/**
 * The point at which this player's team took a lead they never gave up.
 *
 * Read backwards for the last moment the margin was not positive, which
 * is a more useful thing to name than the first lead: a team that led
 * early and was pegged back did not "take the lead" there in any sense
 * the player would recognise.
 *
 * Returns null for a match that was never behind or level, since "took
 * the lead at 1-0" is not worth saying.
 */
export function turningPoint(margins) {
  if (!margins || margins.length < 4) return null
  const final = margins[margins.length - 1]
  if (final <= 0) return null

  let index = -1
  for (let i = margins.length - 1; i >= 0; i -= 1) {
    if (margins[i] <= 0) {
      index = i
      break
    }
  }
  // Never behind or level at all, or it only turned on the last point.
  if (index === -1 || index >= margins.length - 1) return null

  // The margin alone doesn't carry the scoreline, but the point number
  // and the margin together do: after n scored points with a margin of
  // m, the split is (n + m) / 2 to (n - m) / 2.
  const at = index + 2
  const margin = margins[index + 1]
  const yours = Math.round((at + margin) / 2)
  return { at, yours, theirs: at - yours }
}

/**
 * The most interesting single thing about the match, or null when
 * nothing stands out -- better to say nothing than to dress up an
 * ordinary game.
 *
 * @param {number[]} margins - the lead from this player's side, per point.
 * @param {boolean} won
 * @param {number} [pointTarget] - what the game was played to, so the
 *   thresholds mean the same thing across formats. Defaults to 11.
 */
export function matchStory(margins, won, pointTarget = STORY_BASE_TARGET) {
  if (!margins || margins.length < 3) return null

  const worst = Math.min(...margins)
  const best = Math.max(...margins)
  const run = longestRun(margins)

  const big = scaled(4, pointTarget)
  const streak = scaled(5, pointTarget)
  const small = scaled(2, pointTarget)

  if (won && worst <= -big) return `Came back from ${Math.abs(worst)} down`
  if (won && worst >= 0) return 'Never trailed'
  if (!won && best >= big) return `Led by ${best} at one point`
  if (run >= streak) return `${run} points in a row`
  if (won && worst <= -small) return `Trailed by ${Math.abs(worst)} early on`
  return null
}
