// ============================================================
// One short tip for each fault a player can practise away.
//
// Keyed by the umpire app's ending keys (server/src/rally-endings.js).
// Three faults have no entry on purpose: being hit by the ball, lining
// up as the wrong server or receiver, and "other" mistakes. There is
// nothing useful to practise for those, and a tip that says nothing is
// worse than none.
//
// Said the way players talk at the court -- "the kitchen", not "the
// no-volley zone".
// ============================================================

export const FAULT_TIPS = {
  out: 'Aim for the middle, well inside the lines.',
  net: 'Lift it: a paddle’s height over the net.',
  dink_error: 'Small swing, open paddle, just over the net.',
  kitchen: 'Volley from a step behind the kitchen line.',
  service: 'Slow it down and aim deep to the middle.',
  foot_fault: 'Feet behind the baseline until you’ve hit.',
  two_bounce: 'Let the serve and the return bounce first.',
  net_touch: 'Near the net, stop your swing early.',
}

export const TIPS_SHOWN = 3

/**
 * The faults worth a tip, most frequent first.
 *
 * From the rating screen's breakdown: only the player's own endings
 * that have a tip and happened at least once. Ordered by how often, not
 * by points: the card shows only how many times, so a points order would
 * look shuffled. Ties go to the fault that cost more points, then to the
 * list order above, so the order never shuffles between visits.
 */
export function faultsToWorkOn(breakdown, limit = TIPS_SHOWN) {
  const order = Object.keys(FAULT_TIPS)
  return (breakdown ?? [])
    .filter((row) => row.ending && FAULT_TIPS[row.ending] && row.rallies > 0)
    .sort((a, b) =>
      b.rallies - a.rallies ||
      a.points - b.points ||
      order.indexOf(a.ending) - order.indexOf(b.ending))
    .slice(0, limit)
    .map((row) => ({ ...row, tip: FAULT_TIPS[row.ending] }))
}
