// ============================================================
// The match of the month, in words.
//
// The FACTS about the game -- when it was level, when the lead changed,
// how many game points went begging -- are counted on the server
// (server/src/drama.js), because the board ranks games on them and the
// page must show the same numbers the ranking used. This file only turns
// those facts into a sentence. Nothing here is about any one person's
// shots.
//
// Pure, so scripts/check-drama.mjs can test it without a browser.
// ============================================================

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** "five" reads better than "5" in a sentence; big numbers stay digits. */
export function inWords(n) {
  return WORDS[n] ?? String(n)
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
