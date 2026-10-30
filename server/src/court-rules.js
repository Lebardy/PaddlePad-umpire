// ============================================================
// Who may start a court of an open play. Pure, checked offline by
// scripts/check-court-rules.mjs.
//
// A failed check never refuses the session: the phone's sync queue
// sets aside a refused request for good, which would strand its
// matches. The caller stores a plain session and tells the umpire why.
// ============================================================

export const COURT_LEAD_MS = 60 * 60_000
const AHEAD_MS = 5 * 60_000
const BEHIND_MS = 24 * 60 * 60_000

/** The phone's start time, unless its clock is clearly wrong; then the server's. Offline sessions arrive late, so a day back is fine. */
export function clampStartsAt(startsAt, now) {
  const t = startsAt == null ? NaN : new Date(startsAt).getTime()
  if (Number.isNaN(t) || t > now.getTime() + AHEAD_MS || t < now.getTime() - BEHIND_MS) return new Date(now)
  return new Date(t)
}

const firstName = (name) => String(name).trim().split(/\s+/)[0]

/** null when the umpire may start this court; else { taken: first name } or { refused: reason }. */
export function courtStartProblem({ openPlay, umpire, court, startsAt, assignee, heldBy }) {
  if (!openPlay || openPlay.facilityId !== umpire.facilityId) return { refused: 'That open play is gone' }
  if (!openPlay.umpire) return { refused: 'That open play has no umpire' }
  if (!Number.isInteger(court) || court < 1 || court > openPlay.courts) return { refused: `There is no Court ${court}` }
  // Judged on when the umpire tapped Start, not when it reached us.
  const t = new Date(startsAt).getTime()
  if (t < new Date(openPlay.startsAt).getTime() - COURT_LEAD_MS) return { refused: "That open play hadn't started" }
  if (t > new Date(openPlay.endsAt).getTime()) return { refused: 'That open play had ended' }
  if (assignee?.active && assignee.id !== umpire.id) return { refused: `Court ${court} is ${firstName(assignee.name)}'s tonight` }
  if (heldBy) return { taken: firstName(heldBy) }
  return null
}

/** The one sentence the umpire sees when a court start became a plain session. */
export function courtNoticeText(court, problem) {
  return problem.taken
    ? `Court ${court} was already started by ${problem.taken}. Saved as a plain session.`
    : `${problem.refused}. Saved as a plain session.`
}
