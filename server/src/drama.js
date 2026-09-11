// ============================================================
// What happened in a game, read off its score -- one copy, here.
//
// Used twice, and the reason it lives on the server: the monthly board
// RANKS games on these facts (a game the losers nearly won beats one
// that merely had more points), and the match-of-the-month page SHOWS
// them. If the page counted lead changes with its own copy, the two
// could disagree -- a game picked for "the most lead changes" showing
// a different number beside it. The player app cannot import from
// here (it is a separate Railway service), so the server sends the
// result instead.
//
// Pure functions over the lead after each point, from the winners'
// side, and what the game was played to. Nothing about any one
// person's shots.
// ============================================================

/**
 * The score after every point, winners first.
 *
 * After n points with the winners m ahead, the split is (n + m) / 2 to
 * (n - m) / 2 -- the same arithmetic story.js uses for its turning point.
 */
export function scorePath(margins) {
  return margins.map((m, i) => {
    const n = i + 1
    return { winners: (n + m) / 2, losers: (n - m) / 2 }
  })
}

/**
 * Everything dramatic about a game, from the lead after each point.
 *
 * A GAME POINT is a point that would win it: whoever was serving for it
 * was one point from the target with at least a one-point lead already,
 * so the next point would put them two clear. The winners' last game
 * point is the one they took, so every one before it was saved.
 */
export function readGame(margins, pointTarget) {
  const path = scorePath(margins)

  let level = 0
  let leadChanges = 0
  let leader = 0
  let lastLevelAt = -1
  let lowest = { margin: 0, at: -1 }
  let winnersGamePoints = 0
  let losersGamePoints = 0
  let run = { by: null, points: 0 }
  let current = { by: null, points: 0 }

  let before = { winners: 0, losers: 0 }
  path.forEach((after, i) => {
    // Going into this point, could either side win it here?
    if (before.winners + 1 >= pointTarget && before.winners + 1 - before.losers >= 2) {
      winnersGamePoints += 1
    }
    if (before.losers + 1 >= pointTarget && before.losers + 1 - before.winners >= 2) {
      losersGamePoints += 1
    }

    const scorer = after.winners > before.winners ? 'winners' : 'losers'
    current = current.by === scorer
      ? { by: scorer, points: current.points + 1 }
      : { by: scorer, points: 1 }
    if (current.points > run.points) run = current

    const margin = after.winners - after.losers
    if (margin === 0) {
      level += 1
      lastLevelAt = i
    }
    const side = Math.sign(margin)
    if (side !== 0 && leader !== 0 && side !== leader) leadChanges += 1
    if (side !== 0) leader = side
    if (margin < lowest.margin) lowest = { margin, at: i }

    before = after
  })

  return {
    path,
    level,
    leadChanges,
    // The winners' worst moment, as a score, or null if they never
    // trailed at all.
    lowPoint: lowest.at === -1 ? null : { ...path[lowest.at], index: lowest.at },
    // The last time it was level -- where the game was actually decided,
    // which says more than the first time it was.
    lastLevel: lastLevelAt === -1 ? null : { ...path[lastLevelAt], index: lastLevelAt },
    // Chances the eventual winners had before the one they took.
    savedByLosers: Math.max(winnersGamePoints - 1, 0),
    winnersGamePoints,
    // Chances the losers had and did not take -- which the winners saved.
    savedByWinners: losersGamePoints,
    longestRun: run,
  }
}

/**
 * The order the board prefers between two games won by the same margin,
 * most important first, each with the words the page uses when that is
 * what decided it.
 *
 * A strict order rather than a points formula, so the page can always
 * say truthfully WHY a game was picked. First, the game the losing side
 * came closest to winning -- they had game points and did not take them
 * -- because "could have gone either way" is the heart of a close game.
 * Then how much it swung, then how often it was level, then how long the
 * finish dragged on. Only after all of those, the longer game.
 */
export const DRAMA_ORDER = [
  { key: 'losersGamePoints', of: (d) => d.savedByWinners },
  { key: 'leadChanges', of: (d) => d.leadChanges },
  { key: 'level', of: (d) => d.level },
  { key: 'savedGamePoints', of: (d) => d.savedByLosers },
]
