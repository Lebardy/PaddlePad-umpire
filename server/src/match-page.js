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

/** The match page's whole answer. `row` is the route's query row; the rest is what the route gathered. */
export function pageMatch(row, { points, video, names, score, hasVideoRow, isOwner }) {
  const side = (ids) => ids.map((id) => ({ id, name: names.get(id) ?? 'Someone' }))
  return {
    id: row.id, status: row.status, endedEarly: row.ended_early === true,
    voided: row.voided_at ? { at: row.voided_at, reason: row.void_reason ?? null } : null,
    sessionName: row.session_name, facilityId: row.facility_id, facilityName: row.facility_name ?? null,
    umpireId: row.recorded_by ?? null, umpireName: row.umpire_name ?? null,
    startedAt: row.started_at, endedAt: row.ended_at, pointTarget: row.point_target, winner: row.winner ?? null,
    teamA: side(row.team_a), teamB: side(row.team_b), scoreA: score.A, scoreB: score.B,
    points, video, mayRemoveVideo: isOwner && hasVideoRow,
  }
}
