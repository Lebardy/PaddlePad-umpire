// ============================================================
// A player's level: one ML run's levels, placed by today's ratings.
//
// Ratings are public on the leaderboard, so the level follows the rating.
// The run (ml/run.py build_levels) decides how many levels there are and
// each one's average; a player is on the level whose average is nearest
// their current rating, and each level's numbers are the run's players
// placed the same way. Shaped for the app, highest first. Pure, so
// scripts/check-levels.mjs proves it with no database.
// ============================================================

export const LADDER = ['Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert']

/**
 * Null when there is nothing honest to show: fewer than two levels, no
 * current rating, or a level left with nobody. `runPoints` holds every run
 * player's current rating, undefined for one who has none.
 */
export function levelForPlayer({ levels, points, runPoints }) {
  if (!Array.isArray(levels) || levels.length < 2 || !Number.isFinite(points)) return null
  // Halfway between each neighbouring pair's averages (stored lowest first); a rating on a line goes up.
  const lines = levels.slice(1).map((upper, i) => (levels[i].average + upper.average) / 2)
  const levelOf = (value) => lines.filter((line) => value >= line).length
  const placed = levels.map(() => [])
  for (const value of runPoints) if (Number.isFinite(value)) placed[levelOf(value)].push(value)
  if (placed.some((values) => values.length === 0)) return null
  const index = levelOf(points)
  const rank = LADDER.indexOf(levels[index].name) + 1
  if (!rank) return null
  const averages = placed.map(mean)
  const rows = levels.map((level, i) => ({
    name: level.name,
    players: placed[i].length,
    average: Math.round(averages[i]),
    spread: Math.round(spread(placed[i], averages[i])),
    ...(i === index ? { mine: true } : {}),
    // The gap to the level above, from the averages shown so the three numbers agree.
    ...(i < levels.length - 1 ? { gapAbove: Math.round(averages[i + 1]) - Math.round(averages[i]) } : {}),
  }))
  return {
    name: levels[index].name,
    rank,
    position: index + 1,
    of: levels.length,
    you: Math.round(points),
    levels: rows.reverse(),
  }
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** The sample standard deviation (n - 1), as the run's own spread; 0 for a level of one. */
function spread(values, average) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / (values.length - 1))
}
