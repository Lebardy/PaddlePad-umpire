// ============================================================
// The order of a run's skill groups, lowest first.
//
// The pipeline names its groups by average rally points and records the
// order it used in the run's notes (structure.groupOrder). The ladder on
// the rating screen follows that order, so "A step up" is always the
// group the pipeline named higher.
//
// Older runs were named by the old score and recorded no order; for
// those the ladder keeps its old order, by each group's middle score,
// which is what named them. So is an order that does not cover every
// group, rather than guessing where the rest go.
// ============================================================

/**
 * @param {Array<{ name: string }>} ladder groups already sorted by middle score
 * @param {unknown} groupOrder names lowest to highest, from the run's notes
 */
export function orderLadder(ladder, groupOrder) {
  if (!Array.isArray(groupOrder)) return [...ladder]
  const position = new Map(groupOrder.map((name, i) => [name, i]))
  if (!ladder.every((group) => position.has(group.name))) return [...ladder]
  return [...ladder].sort((a, b) => position.get(a.name) - position.get(b.name))
}
