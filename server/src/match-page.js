// ============================================================
// What the admin site's match page is told. Pure: no database.
// ============================================================

import { pointEndings, pointScores } from './player-stats.js'
import { rallyEnding } from './rally-endings.js'

/** Every point in play order: the score after it, whose it was, how it ended and who did it. */
export function matchPagePoints(row, log, nameOf) {
  const scores = pointScores(row, log)
  return pointEndings(row, log).map(({ how, ending, by }, index) => {
    const before = scores[index - 1] ?? { a: 0, b: 0 }
    return {
      ...scores[index],
      team: scores[index].a > before.a ? 'A' : 'B',
      how,
      label: rallyEnding(ending)?.label ?? (how === 'winner' ? 'Winning shot' : 'Mistake'),
      by: nameOf.get(by) ?? null,
    }
  })
}
