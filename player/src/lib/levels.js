// ============================================================
// The level plate's arithmetic: one scale for every level's band and
// the player's own dot, and the words a screen reader hears.
// ============================================================

/** A shared scale: every band (average ± spread) and the player, with 4% room each side. */
export function levelScale(level) {
  const ends = level.levels.flatMap((row) => [row.average - row.spread, row.average + row.spread])
  if (Number.isFinite(level.you)) ends.push(level.you)
  const lo = Math.min(...ends)
  const hi = Math.max(...ends)
  const room = (hi - lo) * 0.04 || 10
  return { lo: lo - room, hi: hi + room }
}

/** Where a value sits on the scale, 0 to 100. */
export function at(scale, value) {
  return ((value - scale.lo) / (scale.hi - scale.lo)) * 100
}

export function plateLabel(level) {
  return `Your level: ${level.name}, ${level.position} of ${level.of}. Show the levels.`
}

/** Each name's rung on the five-word ladder, which picks its picture. */
export const LADDER_RANK = { Beginner: 1, Developing: 2, Intermediate: 3, Advanced: 4, Expert: 5 }
