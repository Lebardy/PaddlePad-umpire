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
  // The same test as the open-play words: fewer than two levels, or one left with nobody, shows nothing.
  if (!levelNamer({ levels, runPoints }) || !Number.isFinite(points)) return null
  const levelOf = placer(levels)
  const placed = levels.map(() => [])
  for (const value of runPoints) if (Number.isFinite(value)) placed[levelOf(value)].push(value)
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

// Halfway between each neighbouring pair's averages (stored lowest first); a rating on a line goes up.
function placer(levels) {
  const lines = levels.slice(1).map((upper, i) => (levels[i].average + upper.average) / 2)
  return (value) => lines.filter((line) => value >= line).length
}

/**
 * The level name for any current rating, by levelForPlayer's lines; null
 * when the run's levels can't be shown (fewer than two, or one left empty).
 */
export function levelNamer({ levels, runPoints }) {
  if (!Array.isArray(levels) || levels.length < 2) return null
  const levelOf = placer(levels)
  const filled = new Set(runPoints.filter(Number.isFinite).map(levelOf))
  if (filled.size < levels.length) return null
  return (points) => (Number.isFinite(points) ? levels[levelOf(points)].name : null)
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** The sample standard deviation (n - 1), as the run's own spread; 0 for a level of one. */
function spread(values, average) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / (values.length - 1))
}
