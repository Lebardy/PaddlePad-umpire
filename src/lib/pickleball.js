// ============================================================
// Pickleball scoring engine
//
// Official side-out scoring: only the serving team can score. Doubles
// gets two servers per side-out except the very first service of the
// game, which is a single "server #2" turn (the standard 0-0-2 start
// announced at the beginning of a game). Games are played to 11,
// win by 2, matching one "game" in the PaddlePad ML pipeline's
// per-match granularity (see pklmart_import.py in that repo).
//
// This module is pure and has no dependency on storage.js: every
// function here takes plain data in and returns plain data out, so
// score/server/stat state is always a deterministic fold over a
// match's event log rather than something mutated and persisted
// separately. That's what makes "undo the last point" in storage.js
// safe -- popping an event and re-running deriveMatchState always
// reproduces the correct prior state.
// ============================================================

/** A fresh zeroed accumulator for the ML pipeline's raw per-player stat columns. */
export function emptyStats() {
  return {
    drop_attempts: 0,
    drop_successes: 0,
    drive_attempts: 0,
    dink_errors: 0,
    clean_winners: 0,
    dink_winners: 0,
    unforced_errors: 0,
  }
}

/** Returns the winning team ('A'|'B') once someone has reached 11+ with a 2-point lead, else null. */
function checkGameWon(score) {
  const leadScore = Math.max(score.A, score.B)
  const trailScore = Math.min(score.A, score.B)
  if (leadScore >= 11 && leadScore - trailScore >= 2) {
    return score.A > score.B ? 'A' : 'B'
  }
  return null
}

/**
 * Advances server state after the serving team loses a rally.
 *
 * Singles: serve just passes to the other team.
 * Doubles: the serving team gets a second server (server #2) before
 * really losing serve, UNLESS this is the very first service of the
 * whole game, which by rule only ever gets one server.
 */
function sideOut(state, isDoubles) {
  const otherTeam = state.servingTeam === 'A' ? 'B' : 'A'

  if (!isDoubles) {
    return { ...state, servingTeam: otherTeam, firstServiceOfGame: false }
  }

  if (state.firstServiceOfGame) {
    return {
      ...state,
      servingTeam: otherTeam,
      serverNumber: 1,
      serverIndex: 0,
      firstServiceOfGame: false,
    }
  }

  if (state.serverNumber === 1) {
    return { ...state, serverNumber: 2, serverIndex: 1 }
  }

  return { ...state, servingTeam: otherTeam, serverNumber: 1, serverIndex: 0 }
}

/**
 * Applies one rally's result to the score/server state: the serving
 * team scores and keeps serve if they won the rally, otherwise it's a
 * side-out (see sideOut) and the score is unchanged.
 */
function applyRallyResult(state, winningTeam, isDoubles) {
  if (winningTeam === state.servingTeam) {
    const score = {
      ...state.score,
      [winningTeam]: state.score[winningTeam] + 1,
    }
    const winner = checkGameWon(score)
    return { ...state, score, completed: !!winner, winner }
  }
  return sideOut(state, isDoubles)
}

/** The score/server state a brand-new match starts in, before any events. */
export function initialScoreState({ firstServerTeam, firstServerIndex, isDoubles }) {
  return {
    score: { A: 0, B: 0 },
    servingTeam: firstServerTeam,
    serverIndex: firstServerIndex,
    serverNumber: isDoubles ? 2 : null,
    firstServiceOfGame: true,
    completed: false,
    winner: null,
  }
}

/**
 * Folds a match's append-only event log into its current score,
 * server position, completion state, and every player's accumulated
 * raw stats -- the exact columns aggregate_player_profiles() in the
 * PaddlePad ML pipeline expects.
 *
 * Two event types are recognized:
 *   'rally'     - a point-ending shot. `outcome` ('winner'|'error') and
 *                 `zone` ('dink'|'open') together select which of the
 *                 four stat buckets (dink/clean winners, dink/unforced
 *                 errors) the acting player is credited with, and
 *                 whose team wins the rally for scoring purposes.
 *   'thirdShot' - a serving-team drop or drive attempt, tracked
 *                 independently of how that rally ended.
 *
 * Folding stops as soon as the game is won, so any events appended
 * after that point (there shouldn't be any -- storage.js blocks
 * writes once a match is completed) are ignored rather than corrupting
 * a finished match's score.
 */
export function deriveMatchState(match) {
  const isDoubles = match.teamA.length === 2

  let scoreState = initialScoreState({
    firstServerTeam: match.firstServer.team,
    firstServerIndex:
      match.firstServer.team === 'A'
        ? match.teamA.indexOf(match.firstServer.playerId)
        : match.teamB.indexOf(match.firstServer.playerId),
    isDoubles,
  })

  const stats = {}
  const ensure = (id) => {
    if (!stats[id]) stats[id] = emptyStats()
  }
  ;[...match.teamA, ...match.teamB].forEach(ensure)

  for (const event of match.events) {
    if (scoreState.completed) break

    if (event.type === 'rally') {
      const actingTeam = match.teamA.includes(event.actingPlayerId) ? 'A' : 'B'
      const bucket =
        event.outcome === 'winner'
          ? event.zone === 'dink'
            ? 'dink_winners'
            : 'clean_winners'
          : event.zone === 'dink'
            ? 'dink_errors'
            : 'unforced_errors'

      ensure(event.actingPlayerId)
      stats[event.actingPlayerId][bucket] += 1

      const winningTeam =
        event.outcome === 'winner'
          ? actingTeam
          : actingTeam === 'A'
            ? 'B'
            : 'A'

      scoreState = applyRallyResult(scoreState, winningTeam, isDoubles)
    } else if (event.type === 'thirdShot') {
      ensure(event.playerId)
      if (event.shotType === 'drop') {
        stats[event.playerId].drop_attempts += 1
        if (event.success) stats[event.playerId].drop_successes += 1
      } else {
        stats[event.playerId].drive_attempts += 1
      }
    }
  }

  return { ...scoreState, isDoubles, stats }
}

/** The player id currently serving, given a match and its derived state. */
export function currentServerPlayerId(derived, match) {
  const team = derived.servingTeam === 'A' ? match.teamA : match.teamB
  return team[derived.serverIndex] ?? team[0]
}
