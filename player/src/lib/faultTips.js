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
  out: 'Aim for the middle of the court, well inside the lines. Save the lines for easy balls.',
  net: 'Lift the ball: aim about a paddle’s height over the net. Most balls into the net are hit too flat.',
  dink_error: 'Keep it short and gentle: small swing, paddle face open, aim just over the net into the kitchen.',
  kitchen: 'When you volley, stay a step back from the kitchen line and let your weight settle before moving forward.',
  service: 'Slow the serve down and aim deep to the middle of the box. A serve that lands beats a fast one that doesn’t.',
  foot_fault: 'Set your feet behind the baseline before you serve, and keep them there until you’ve hit the ball.',
  two_bounce: 'Let the serve and the return each bounce first. After serving, stay back until the return has landed.',
  net_touch: 'After a hard shot near the net, stop your swing early and keep your paddle and body clear of it.',
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
