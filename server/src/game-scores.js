// ============================================================
// Every game a player played, on the rating's own scale.
//
// This is the consistency half of the model made readable. Five of the
// ten features the pipeline computes are about how much someone swings
// between games -- genuinely half the model -- and none of it ever
// reached the player, because "your winner rate varies by 1.20" is not
// a sentence anyone can use. A game that scored 43 beside one that
// scored 94 is.
//
// The property that makes this honest rather than decorative: a
// player's rating IS the average of these scores. Not a summary of
// them, not a model fitted to them -- the mean, exactly. Min-max
// scaling and a weighted sum are both affine, so the average of the
// scores equals the score of the averages, and the pipeline refuses to
// publish a run where that stops holding (ml/run.py).
//
// PRIVACY: nothing to draw here. These are the asking player's own
// games and nobody else's, so unlike the group averages elsewhere
// there is no floor and nothing withheld.
// ============================================================

// Below this, a spread is one or two games rather than a habit, and
// "your best day" would just mean "the day you got lucky". The five
// the rating gate already demands is the same floor.
export const MIN_GAMES_FOR_SPREAD = 5

/** The value at a position through a sorted list, interpolating. */
function quantile(sorted, fraction) {
  if (sorted.length === 0) return null
  const at = (sorted.length - 1) * fraction
  const below = Math.floor(at)
  const above = Math.ceil(at)
  if (below === above) return sorted[below]
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below)
}

function round(value) {
  return value === null ? null : Math.round(value * 10) / 10
}

/**
 * What a player's games looked like.
 *
 * @param {Array<{matchId, score}>} games as stored by the run
 * @param {number} rating this player's rating in the same run
 * @returns {null | object} null when there is too little to describe
 */
export function summariseGames(games, rating) {
  if (!Array.isArray(games) || games.length < MIN_GAMES_FOR_SPREAD) return null

  const scores = games
    .map((game) => Number(game.score))
    .filter(Number.isFinite)
  if (scores.length < MIN_GAMES_FOR_SPREAD) return null

  const sorted = [...scores].sort((a, b) => a - b)
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length

  return {
    count: scores.length,
    worst: round(sorted[0]),
    best: round(sorted[sorted.length - 1]),
    // The middle half. A best and a worst are two games out of nine and
    // move on a fluke; this is where a player actually lives, and it is
    // the honest answer to "how well do I play".
    lower: round(quantile(sorted, 0.25)),
    upper: round(quantile(sorted, 0.75)),
    // Sent so the page can show that the rating really is the middle of
    // these rather than asking anyone to take it on faith. Should equal
    // the rating; if a future run ever disagrees the page can say so
    // instead of drawing a mark in the wrong place.
    average: round(mean),
    rating: round(Number(rating)),
    // A single game can be better than any player's AVERAGE, which is
    // what the 0-100 scale is built from, so a few land outside it. The
    // page clips what it draws and says why.
    outsideScale: scores.filter((score) => score < 0 || score > 100).length,
    games: games
      .map((game) => ({ matchId: game.matchId, score: round(Number(game.score)) }))
      .filter((game) => game.matchId && game.score !== null),
  }
}
