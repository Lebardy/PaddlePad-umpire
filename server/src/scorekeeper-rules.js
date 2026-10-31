// ============================================================
// What a main umpire's ruling does to the scorekeeper's log.
//
// Pure, and shared with the umpire app (it imports this file the way it
// imports pickleball.js), so the phone that applies a ruling and the
// server that refuses a late one agree on what "too late" means.
//
// A ruling never changes score math. It removes the ruled rally or keeps
// it, and leaves a `ruling` note the engine skips -- so the score, the
// player stats, the ML export and old installed apps need nothing new.
// ============================================================

export const RULING_KINDS = ['stands', 'overturned', 'replay', 'wrongWinner']
export const TOO_LATE = 'Too late: the next rally was scored.'
export const TAKEN_BACK = 'Scoring was taken back.'
export const MATCH_OVER = 'The match has finished.'
export const CONCLUDE_FIRST = 'A won match is waiting to be concluded.'
export const CONCLUDE_MOVED = 'The score changed: check the last rally.'

/** The team a rally gave the point to: a winning shot scores for its own side, a mistake for the other. */
export function rallyWinnerTeam(teamA, rally) {
  const acting = teamA.includes(rally.actingPlayerId) ? 'A' : 'B'
  if (rally.outcome === 'winner') return acting
  return acting === 'A' ? 'B' : 'A'
}

/**
 * Why a ruling on `targetEventId` cannot apply to this log, or null.
 * Only the very last event may be ruled on: appeals come before the next
 * serve, and anything logged after the rally (the next rally, its third
 * shot, a serve correction) means play has moved on.
 */
export function rulingProblem(events, targetEventId) {
  const last = events.at(-1)
  return last?.type === 'rally' && last.id === targetEventId ? null : TOO_LATE
}

/**
 * The scorekeeper's log after a ruling, and which team the rally must be
 * entered again for (Overturned / Wrong winner), or `{ refused }`.
 */
export function applyRuling(events, ruling, teamA, at = Date.now()) {
  const problem = rulingProblem(events, ruling.targetEventId)
  if (problem) return { refused: problem }
  const rally = events.at(-1)
  const note = { type: 'ruling', id: ruling.id, at, targetEventId: rally.id, kind: ruling.kind, ruledBy: ruling.ruledByName ?? null }
  if (ruling.kind === 'stands') return { events: [...events, note], reenterFor: null }
  const was = {
    actingPlayerId: rally.actingPlayerId,
    outcome: rally.outcome,
    zone: rally.zone,
    ...(rally.detail ? { detail: rally.detail } : {}),
  }
  const winner = rallyWinnerTeam(teamA, rally)
  return {
    events: [...events.slice(0, -1), { ...note, was }],
    reenterFor: ruling.kind === 'replay' ? null : winner === 'A' ? 'B' : 'A',
  }
}

/** The team an overturned rally still has to be entered for, or null once it has been. */
export function waitingReentry(events, teamA) {
  const last = events.at(-1)
  if (last?.type !== 'ruling' || !last.was || last.kind === 'replay') return null
  return rallyWinnerTeam(teamA, last.was) === 'A' ? 'B' : 'A'
}

/** True when a rally entered after an overturned call gives the point to the other team than the one ruled for. */
export function reentryMismatch(waitingTeam, teamA, rally) {
  return Boolean(waitingTeam) && rallyWinnerTeam(teamA, rally) !== waitingTeam
}

/** The newest ruling on a match: this phone's unsent ones come after anything the server lists (newest first). */
export function newestRuling(queued, rulings) {
  const unsent = queued.at(-1)
  return unsent ? { kind: unsent.kind, targetEventId: unsent.targetEventId, state: 'queued' } : (rulings[0] ?? null)
}

/**
 * Whether the scorekeeper's phone must give the tapping up: it was scoring
 * and no longer is, or its upload was refused (only a moved lease does that).
 * A match finished locally still yields on a refused upload; yieldMatch
 * tells a finish from a take-back, so no false notice shows.
 */
export function keeperMustYield({ isKeeper, wasScoring, blockedLog, completed }) {
  return (!completed && wasScoring) || (isKeeper && blockedLog)
}

/**
 * Whether a won match stays open for the main umpire: while a scorekeeper
 * taps, the winning rally can still be appealed, so it cannot end the match.
 */
export function waitsForUmpire(derived, scorekeeperState) {
  return derived.completed && scorekeeperState === 'scoring'
}
