// ============================================================
// A player's level, read from one ML run's notes.
//
// The run (ml/run.py build_levels) joins skill groups too close to call
// and names what is left from one ladder. This only finds the player's
// level in that list and shapes it for the app, highest first. Pure, so
// scripts/check-levels.mjs proves it with no database.
// ============================================================

export const LADDER = ['Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert']

/** Null when there is nothing honest to show: no levels, one level, or the player outside them. */
export function levelForPlayer({ levels, skillGroup, rallyPoints }) {
  if (!Array.isArray(levels) || levels.length < 2 || !skillGroup) return null
  const index = levels.findIndex((level) => Array.isArray(level.groups) && level.groups.includes(skillGroup))
  if (index < 0) return null
  const rank = LADDER.indexOf(levels[index].name) + 1
  if (!rank) return null
  const rows = levels.map((level, i) => ({
    name: level.name,
    players: level.players,
    average: Math.round(level.average),
    spread: Math.round(level.spread),
    ...(i === index ? { mine: true } : {}),
    // The gap to the level above, from the averages shown so the three numbers agree.
    ...(i < levels.length - 1 ? { gapAbove: Math.round(levels[i + 1].average) - Math.round(level.average) } : {}),
  }))
  return {
    name: levels[index].name,
    rank,
    position: index + 1,
    of: levels.length,
    you: Number.isFinite(rallyPoints) ? Math.round(rallyPoints) : null,
    levels: rows.reverse(),
  }
}
