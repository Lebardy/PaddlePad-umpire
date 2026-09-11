// ============================================================
// What made a game worth watching, read off its score.
//
// For the match of the month, which is shown to people who were not in
// it. Everything here is about the GAME -- when it was level, when the
// lead changed, how many chances to win it went begging -- and nothing
// is about any one person's shots. It needs only the lead after each
// point (from the winners' side) and what the game was played to, both
// of which the page already has, so no new data leaves the server.
//
// Pure functions over plain numbers, which is what lets
// scripts/check-drama.mjs test them without a browser.
// ============================================================

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** "five" reads better than "5" in a sentence; big numbers stay digits. */
export function inWords(n) {
  return WORDS[n] ?? String(n)
}

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

// Thresholds are fractions of a game to 11, scaled to the target, the
// same way story.js scales its own: three down in a game to 11 is a real
// hole, three down in a game to 21 is an ordinary patch.
function scaled(points, pointTarget) {
  return Math.round((points * pointTarget) / 11)
}

/**
 * One sentence that tells the story, naming the winners.
 *
 * Tuned against every close game on staging, not one. Read side by
 * side, the first version opened eleven of the fifteen closest games
 * with "came back from ... down": in a tight game nearly every winner is
 * two behind at some point, so it would have said the same thing every
 * month. A comeback now has to be a real hole, and the lead trading
 * hands or a long run gets its turn before a small one.
 *
 * Every clause is a verb phrase so a name can go in front of it -- the
 * version before that reused story.js, whose "6 points in a row" has no
 * verb, and the page read "Ana & Jae 6 points in a row." At most two
 * facts, how it went and then how it ended: a sentence that tries to say
 * everything says nothing.
 */
export function headline(game, winners, pointTarget) {
  const final = game.path[game.path.length - 1]
  const score = `${final.winners}–${final.losers}`
  const low = game.lowPoint
  const down = low ? low.losers - low.winners : 0
  const lowScore = low ? `${low.winners}–${low.losers}` : ''

  // How it went, as { clause, alone } -- the second form is used when
  // nothing about the ending is worth adding, so the score still gets in
  // without "won ..., winning ..." twice over.
  let went = null
  if (down >= scaled(3, pointTarget)) {
    went = {
      clause: `came back from ${lowScore} down`,
      alone: `came back from ${lowScore} down to win ${score}`,
    }
  } else if (!low) {
    went = { clause: 'never trailed', alone: `never trailed on the way to ${score}` }
  } else if (game.leadChanges >= 3) {
    const n = inWords(game.leadChanges)
    went = {
      clause: `traded the lead ${n} times`,
      alone: `traded the lead ${n} times on the way to ${score}`,
    }
  } else if (game.longestRun.by === 'winners' && game.longestRun.points >= scaled(5, pointTarget)) {
    const n = inWords(game.longestRun.points)
    went = {
      clause: `won ${n} points in a row`,
      alone: `won ${n} points in a row on the way to ${score}`,
    }
  } else if (down >= 2) {
    went = {
      clause: `came back from ${lowScore} down`,
      alone: `came back from ${lowScore} down to win ${score}`,
    }
  }

  // How it ended. Saving the losers' chances is rarer and bigger than
  // needing several of their own, so it comes first.
  let ended = null
  if (game.savedByWinners > 0) {
    const n = game.savedByWinners
    ended = {
      clause: `saved ${inWords(n)} game ${n === 1 ? 'point' : 'points'}`,
      alone: `saved ${inWords(n)} game ${n === 1 ? 'point' : 'points'} to win ${score}`,
    }
  } else if (game.winnersGamePoints >= 2) {
    const n = inWords(game.winnersGamePoints)
    ended = {
      clause: `needed ${n} game points to finish it`,
      alone: `needed ${n} game points to win ${score}`,
    }
  } else if (final.losers >= pointTarget - 1) {
    ended = {
      clause: `won it past ${pointTarget - 1}–${pointTarget - 1}`,
      alone: `won ${score}, past ${pointTarget - 1}–${pointTarget - 1}`,
    }
  }

  if (went && ended) return `${winners} ${went.clause}, then ${ended.clause}.`
  if (went) return `${winners} ${went.alone}.`
  if (ended) return `${winners} ${ended.alone}.`
  return `${winners} won ${score}.`
}
